"""FLOW - process-aware workflow intelligence for Nexora Technologies.

Traditional automation asks "what actions should happen?" This asks "how does
this business already operate, and does a new automation fit that?" The LLM
appears in exactly three places: turning English into a proposed workflow,
turning a policy document into checkable rules, and phrasing a verdict for a
human. Whether something conflicts is decided by engine.py - pure Python over
the process graph and compiled policies - never by the model.
"""
import io
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import engine
import llm
import catalog
import simulation
import graph
import recommendation
import conflict_detector

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

app = FastAPI(title="FLOW API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATS = {"llm_calls": 0, "graph_checks": 0}


@app.on_event("startup")
def startup():
    seeded = db.init_db()
    llm.init_cache()
    cached = llm.cache_stats()["total"]
    print(f"[FLOW] database ready at {db.DB_PATH} (seeded {seeded} workflows)")
    print(f"[FLOW] llm cache ready ({cached} recorded responses)")


@app.get("/api/health")
def health():
    return {"status": "ok", "workflows": len(db.list_workflows())}


@app.get("/api/stats")
def get_stats():
    return {
        **STATS,
        "live_llm_calls": llm.COUNTERS["live_calls"],
        "cached_llm_calls": llm.COUNTERS["cache_hits"] + llm.COUNTERS["safety_hits"],
        "safety_mode": llm.safety_mode(),
    }


@app.get("/api/demo-mode")
def get_demo_mode():
    return {"safety_mode": llm.safety_mode(), "cache": llm.cache_stats(), "counters": llm.COUNTERS}


class DemoModeRequest(BaseModel):
    enabled: bool


@app.post("/api/demo-mode")
def set_demo_mode(req: DemoModeRequest):
    enabled = llm.set_safety_mode(req.enabled)
    return {"safety_mode": enabled, "cache": llm.cache_stats(), "counters": llm.COUNTERS}


@app.post("/api/reset")
def reset_demo():
    seeded = db.init_db(force_reseed=True)
    graph.invalidate_graph_cache()
    for key in STATS:
        STATS[key] = 0
    return {"reseeded": seeded}


# --- Workflows (Dashboard + detail modal) -----------------------------------
@app.get("/api/workflows")
def list_workflows(include_proposed: bool = False):
    workflows = db.list_workflows(include_proposed=include_proposed)
    for wf in workflows:
        wf["step_count"] = len(wf["steps"])
    return {"workflows": workflows}


@app.get("/api/workflows/{workflow_id}")
def get_workflow(workflow_id: int):
    wf = db.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="No such workflow.")
    dep_map = db.dependency_map()
    wf["depends_on"] = dep_map["incoming"].get(workflow_id, [])
    wf["leads_to"] = dep_map["outgoing"].get(workflow_id, [])
    return {"workflow": wf}


@app.delete("/api/workflows/{workflow_id}")
def delete_workflow(workflow_id: int):
    if not db.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="No such workflow.")
    graph.invalidate_graph_cache()
    return {"deleted": workflow_id}


# --- Analyze: plain English -> proposed workflow (1 LLM call) ---------------
WORKFLOW_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Short workflow name, max 6 words."},
        "department": {
            "type": "string",
            "enum": ["Sales", "Finance", "Legal", "Customer Success", "Support", "Procurement", "Operations"],
        },
        "description": {"type": "string", "description": "One sentence, plain English."},
        "origin_step": {
            "type": "string",
            "description": (
                "The exact name of the existing step or event this workflow starts from. "
                "Must match wording likely to already exist in the company's process memory "
                "(e.g. 'Deal Closed', 'Finance Verification Complete', 'Contract Signed')."
            ),
        },
        "steps": {
            "type": "array",
            "description": "The origin step first, then each new step this workflow performs, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name", "description"],
            },
        },
    },
    "required": ["name", "department", "description", "origin_step", "steps"],
}

ANALYZE_SYSTEM = """You convert a plain-English workflow proposal into a structured step
sequence for a B2B SaaS company (Nexora Technologies: Sales, Finance, Legal,
Customer Success, Support, Procurement).

Rules:
- "origin_step" is the trigger event this workflow starts from - phrase it the
  way it would already appear in an existing process (e.g. a deal closing is
  "Deal Closed", finance signing off is "Finance Verification Complete").
- "steps" starts with that same origin step, then lists every new action in
  order. Keep step names short (2-5 words) and business-readable.
- Do not invent department names outside the allowed list.
- Keep the whole thing tight: 2-5 steps is typical."""


class AnalyzeRequest(BaseModel):
    text: str


@app.post("/api/analyze")
def analyze_workflow(req: AnalyzeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Describe a workflow first.")
    try:
        parsed = llm.llm_json(
            "analyze", text, system=ANALYZE_SYSTEM, schema=WORKFLOW_SCHEMA, max_tokens=1500
        )
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1
    saved = db.insert_workflow(parsed, status="created", is_proposed=True)
    graph.invalidate_graph_cache()
    return {"proposal": saved, "raw_text": text}


# --- Evaluate: pure-Python graph + policy reasoning -------------------------
@app.post("/api/evaluate/{proposal_id}")
def evaluate_proposal(proposal_id: int):
    proposal = db.get_workflow(proposal_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail="No such proposal.")

    workflows = db.list_workflows()
    dep_map = db.dependency_map()
    policy_rules = db.list_policy_rules(active_only=True)

    verdict = engine.evaluate_proposal(proposal, workflows, dep_map, policy_rules)
    STATS["graph_checks"] += 1

    return {
        "proposal": proposal,
        "status": verdict["status"],
        "origin_workflow": verdict["origin_workflow"],
        "target_workflow": verdict["target_workflow"],
        "existing_path": verdict["existing_path"],
        "skipped_workflows": verdict["skipped_workflows"],
        "violated_rules": verdict["violated_rules"],
        "reasoning": verdict["reasoning"],
    }


EXPLAIN_SYSTEM = """You explain, to a business operator, whether a proposed workflow
fits how their company already operates.

Write exactly two short paragraphs, no headings, no markdown, no bullets:
1. What the system found - name the existing process the proposal attaches to
   and, if there's a conflict, exactly what it skips and why that matters.
2. Either a concrete fix (what to insert, or where the workflow should really
   attach), or - if compatible - a one-line confirmation of why it's safe.

Stay under 100 words. Never invent facts not given to you."""


class ExplainRequest(BaseModel):
    proposal: dict
    status: str
    origin_workflow: dict | None = None
    target_workflow: dict | None = None
    skipped_workflows: list = []
    violated_rules: list = []
    reasoning: str = ""


@app.post("/api/evaluate/explain")
def explain_evaluation(req: ExplainRequest):
    prompt = (
        f"Proposed workflow: \"{req.proposal.get('name')}\" - {req.proposal.get('description')}\n"
        f"Steps: {' -> '.join(s['name'] for s in req.proposal.get('steps', []))}\n\n"
        f"Verdict: {req.status}\n"
        f"Attaches to existing process: {req.origin_workflow.get('name') if req.origin_workflow else 'none found'}\n"
        f"Skips: {', '.join(w['name'] for w in req.skipped_workflows) or 'nothing'}\n"
        f"Violates policy: {', '.join(r['text'] for r in req.violated_rules) or 'none'}\n"
        f"Deterministic reasoning: {req.reasoning}"
    )
    try:
        explanation = llm.llm_call(
            "explain-evaluation", prompt, system=EXPLAIN_SYSTEM, max_tokens=500, json_out=False
        ).strip()
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1
    return {"explanation": explanation}


# --- Adopt: proposal becomes a real, active workflow ------------------------
class AdoptRequest(BaseModel):
    origin_workflow_id: int | None = None
    steps: list | None = None


@app.post("/api/workflows/{proposal_id}/adopt")
def adopt_proposal(proposal_id: int, req: AdoptRequest):
    proposal = db.get_workflow(proposal_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail="No such proposal.")

    conn = db.connect()
    conn.execute(
        "UPDATE workflows SET status='active', is_proposed=0 WHERE id=?", (proposal_id,)
    )
    if req.steps is not None:
        conn.execute(
            "UPDATE workflows SET steps=? WHERE id=?", (json.dumps(req.steps), proposal_id)
        )
    conn.commit()
    conn.close()

    if req.origin_workflow_id:
        db.add_dependency(
            req.origin_workflow_id, proposal_id, "precedes", "Adopted after conflict review"
        )

    graph.invalidate_graph_cache()
    return {"workflow": db.get_workflow(proposal_id)}


class StatusUpdateRequest(BaseModel):
    status: str


@app.post("/api/workflows/{workflow_id}/status")
def update_workflow_status(workflow_id: int, req: StatusUpdateRequest):
    wf = db.get_workflow(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="No such workflow.")
    conn = db.connect()
    is_prop = 0 if req.status in ("converted", "active") else 1
    conn.execute(
        "UPDATE workflows SET status=?, is_proposed=? WHERE id=?",
        (req.status, is_prop, workflow_id)
    )
    conn.commit()
    conn.close()
    graph.invalidate_graph_cache()
    return {"id": workflow_id, "status": req.status}


@app.post("/api/workflows/{proposal_id}/reject")
def reject_proposal(proposal_id: int):
    if not db.delete_workflow(proposal_id):
        raise HTTPException(status_code=404, detail="No such proposal.")
    graph.invalidate_graph_cache()
    return {"rejected": proposal_id}


# --- Process Memory: the full graph ------------------------------------------
@app.get("/api/process-memory")
def process_memory():
    workflows = db.list_workflows()
    policy_rules = db.list_policy_rules(active_only=True)

    by_department = {}
    for wf in workflows:
        by_department.setdefault(wf["department"], []).append(wf)

    nodes = [
        {
            "id": wf["id"],
            "name": wf["name"],
            "department": wf["department"],
            "description": wf["description"],
            "step_count": len(wf["steps"]),
        }
        for wf in workflows
    ]
    edges = db.list_dependencies()

    return {
        "departments": [
            {"department": dept, "workflows": wfs}
            for dept, wfs in sorted(by_department.items())
        ],
        "nodes": nodes,
        "edges": edges,
        "policy_count": len(policy_rules),
        "workflow_count": len(workflows),
    }


# --- Policy documents ---------------------------------------------------------
POLICY_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "rules": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short rule name, max 6 words."},
                    "text": {"type": "string", "description": "The rule, as one plain sentence."},
                    "department": {
                        "type": "string",
                        "enum": ["Sales", "Finance", "Legal", "Customer Success",
                                 "Support", "Procurement", "Operations", "Company-wide"],
                    },
                    "required_workflow": {
                        "type": "string",
                        "description": (
                            "If this rule requires one process to complete before another can "
                            "start, the name of the process that must complete first. Empty "
                            "string if this rule isn't that kind of ordering requirement."
                        ),
                    },
                    "before_step": {
                        "type": "string",
                        "description": "The step that may not happen until required_workflow completes.",
                    },
                },
                "required": ["title", "text", "department", "required_workflow", "before_step"],
            },
        }
    },
    "required": ["rules"],
}

POLICY_EXTRACT_SYSTEM = """You extract checkable business-process rules from a policy document
for a B2B SaaS company (Nexora Technologies).

For each distinct rule in the document:
- Write a short title and the rule as one plain sentence.
- If the rule requires one existing process to finish before another can
  start (an ordering constraint), set required_workflow to the name of the
  process that must finish first, and before_step to what it's gating. Use
  the department names and process language a SaaS company would actually
  use (Sales, Finance, Legal, Customer Success, Support, Procurement).
- If the rule isn't an ordering constraint (e.g. a general principle with
  nothing to check programmatically), leave required_workflow and before_step
  as empty strings - it will still be shown to users, just not enforced.
Extract every distinct rule; do not merge unrelated rules into one."""


@app.get("/api/policy-documents")
def list_policy_documents():
    docs = db.list_policy_documents()
    rules = db.list_policy_rules()
    for doc in docs:
        doc["rules"] = [r for r in rules if r["document_id"] == doc["id"]]
    return {"documents": docs}


@app.post("/api/policy-documents/upload")
async def upload_policy_document(file: UploadFile = File(...)):
    raw = await file.read()
    filename = file.filename or "policy.txt"

    if filename.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Only .txt and .pdf files are supported.")

    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="The document appears to be empty.")

    try:
        extracted = llm.llm_json(
            "extract-policy", text, system=POLICY_EXTRACT_SYSTEM,
            schema=POLICY_EXTRACT_SCHEMA, max_tokens=2000,
        )
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1
    doc_id = db.insert_policy_document(filename, text)
    saved_rules = []
    for rule in extracted.get("rules", []):
        compiled = {"type": "require_precedes"} if rule.get("required_workflow") else {"type": "informational"}
        if rule.get("required_workflow"):
            compiled["required_workflow"] = rule["required_workflow"]
            compiled["before_step"] = rule.get("before_step", "")
        saved_rules.append(
            db.insert_policy_rule(doc_id, rule["title"], rule["text"], rule["department"], compiled)
        )

    return {"document_id": doc_id, "filename": filename, "rules": saved_rules}


class PolicyRuleActiveRequest(BaseModel):
    active: bool


@app.patch("/api/policy-rules/{rule_id}")
def toggle_policy_rule(rule_id: int, req: PolicyRuleActiveRequest):
    if not db.set_policy_rule_active(rule_id, req.active):
        raise HTTPException(status_code=404, detail="No such policy rule.")
    return {"rule": db.get_policy_rule(rule_id)}


@app.delete("/api/policy-rules/{rule_id}")
def delete_policy_rule(rule_id: int):
    if not db.delete_policy_rule(rule_id):
        raise HTTPException(status_code=404, detail="No such policy rule.")
    return {"deleted": rule_id}


# --- Connector Catalog --------------------------------------------------------
@app.get("/api/catalog")
def get_catalog():
    return catalog.get_catalog()


# --- Simulation Engine --------------------------------------------------------
@app.post("/api/simulate/{workflow_id}")
def run_workflow_simulation(workflow_id: int):
    wf = db.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="No such workflow.")
    
    # Mark workflow as in_progress
    conn = db.connect()
    conn.execute("UPDATE workflows SET status='in_progress' WHERE id=?", (workflow_id,))
    conn.commit()
    conn.close()

    report = simulation.run_simulation(wf)
    
    # If simulation found issues or faults, mark workflow as needing review
    failed = report.get("failed_scenarios", 0) or report.get("outcomes", {}).get("failed_or_terminated_early", 0)
    conn = db.connect()
    if failed > 0:
        conn.execute("UPDATE workflows SET status='review' WHERE id=?", (workflow_id,))
    else:
        conn.execute("UPDATE workflows SET status='in_progress' WHERE id=?", (workflow_id,))
    conn.commit()
    conn.close()
    
    return report


@app.get("/api/simulate/{workflow_id}/last")
def get_last_simulation(workflow_id: int):
    report = simulation.get_last_simulation_report(workflow_id)
    if report is None:
        raise HTTPException(status_code=404, detail="No simulation report found for this workflow.")
    return report


# --- Workflow Dependency Graph ("Workflow X-Ray") ----------------------------
@app.get("/api/graph")
def get_workflow_dependency_graph(workflow_id: int | None = None):
    return graph.build_dependency_graph(focused_workflow_id=workflow_id)


# --- Post-Creation SVS Recommendation ----------------------------------------
@app.get("/api/recommendation/{workflow_id}")
def get_workflow_recommendation(workflow_id: int):
    return recommendation.compute_recommendation(workflow_id)


# --- Field-Level Conflict Detection ------------------------------------------
@app.get("/api/conflicts")
def get_conflicts():
    workflows = db.list_workflows(include_proposed=True)
    findings = conflict_detector.detect_all_conflicts(workflows)
    return {"conflicts": findings, "count": len(findings)}


@app.get("/api/conflicts/{workflow_id}")
def get_workflow_conflicts(workflow_id: int):
    workflows = db.list_workflows(include_proposed=True)
    all_conflicts = conflict_detector.detect_all_conflicts(workflows)
    wf_id_str = str(workflow_id)
    matching = [
        c for c in all_conflicts
        if any(str(w.get("id")) == wf_id_str or str(w.get("id")) == f"wf_{wf_id_str}"
               for w in c.get("involved_workflows", []))
    ]
    return {"conflicts": matching, "count": len(matching)}


@app.post("/api/workflows/seed-samples")
def seed_sample_workflows():
    sample_a = {
        "name": "Lead Router",
        "department": "Sales",
        "description": "Routes inbound form submissions to account reps in HubSpot.",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Contact Owner", "operation_id": "hubspot.assign_owner"},
        ],
        "business_rules": [],
        "status": "created",
        "is_proposed": False,
    }
    sample_b = {
        "name": "Regional Assigner",
        "department": "Sales",
        "description": "Re-assigns contact ownership when contact update event occurs.",
        "steps": [
            {"name": "Contact Updated", "trigger_id": "hubspot.contact_updated"},
            {"name": "Update Contact Record", "operation_id": "hubspot.update_contact"},
        ],
        "business_rules": [],
        "status": "created",
        "is_proposed": False,
    }
    sample_c = {
        "name": "Sheet Logger",
        "department": "Operations",
        "description": "Logs form submissions into Google Sheets for audit.",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Append Row to Sheet", "operation_id": "sheets.append_row"},
        ],
        "business_rules": [],
        "status": "created",
        "is_proposed": False,
    }

    # Idempotent: remove previous sample workflows if they exist
    existing = db.list_workflows(include_proposed=True)
    sample_names = {"Lead Router", "Regional Assigner", "Sheet Logger"}
    for wf in existing:
        if wf.get("name") in sample_names:
            db.delete_workflow(wf["id"])

    saved_a = db.insert_workflow(sample_a, status="created", is_proposed=False)
    saved_b = db.insert_workflow(sample_b, status="created", is_proposed=False)
    saved_c = db.insert_workflow(sample_c, status="created", is_proposed=False)
    graph.invalidate_graph_cache()

    return {
        "seeded": [saved_a, saved_b, saved_c],
        "count": 3,
        "message": "Sample workflows created successfully through standard pipeline."
    }



