"""FLOW - AI-Powered Business Automation Copilot (backend)."""
import json
import os

from google import genai
from google.genai import types
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import engine

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

MODEL = "gemini-2.5-flash"

app = FastAPI(title="FLOW API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Beat 5: session counters. LLM work and pure-Python work tracked separately
# so the cost story is visible on the dashboard.
STATS = {
    "llm_calls": 0,
    "rules_evaluated": 0,
    "simulations_run": 0,
    "conflict_scans": 0,
    "pairs_compared": 0,
    "conflict_llm_calls": 0,
}

_client = None
CONFLICTS_BY_WORKFLOW = {}


def gemini():
    """Lazily build the Gemini client so the server boots without a key."""
    global _client
    if _client is None:
        if not os.environ.get("GEMINI_API_KEY"):
            raise HTTPException(
                status_code=503,
                detail="GEMINI_API_KEY is not set. Add it to backend/.env and restart.",
            )
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def gemini_error(exc):
    if "API_KEY_INVALID" in str(exc) or "API key not valid" in str(exc):
        return "GEMINI_API_KEY is invalid. Create a new key in Google AI Studio and update backend/.env."
    return f"Gemini API error: {exc}"


@app.on_event("startup")
def startup():
    seeded = db.init_db()
    print(f"[FLOW] database ready at {db.DB_PATH} (seeded {seeded} workflows)")


# --- Schemas ---------------------------------------------------------------
class ParseRequest(BaseModel):
    text: str
    source_system: str = "Internal"


class SimulateRequest(BaseModel):
    workflow: dict


class WorkflowRequest(BaseModel):
    workflow: dict


class ExplainRequest(BaseModel):
    conflict: dict


class ResolveRequest(BaseModel):
    rule_a: dict
    rule_b: dict


class ApplyFixRequest(BaseModel):
    fix: dict


TRIGGER_TYPES = [
    "order_status_change",
    "order_created",
    "invoice_submitted",
    "shipment_created",
    "payment_received",
    "other",
]

PARSE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "Short human-readable rule name, max 6 words.",
        },
        "trigger": {
            "type": "string",
            "description": "The business event, title case. e.g. 'Order status change'.",
        },
        "trigger_type": {"type": "string", "enum": TRIGGER_TYPES},
        "conditions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "description": (
                            "One of: status, hours_since_update, amount, warehouse, "
                            "customer, vendor."
                        ),
                    },
                    "operator": {
                        "type": "string",
                        "enum": [">", ">=", "<", "<=", "equals", "not_equals", "contains"],
                    },
                    "value": {
                        "type": "string",
                        "description": "Plain value; use numeric text for hours and money.",
                    },
                    "display": {
                        "type": "string",
                        "description": "Readable phrasing, e.g. 'packed for more than 48 hours'.",
                    },
                },
                "required": ["field", "operator", "value", "display"],
            },
        },
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "description": (
                            "Verb: notify, alert, flag, approve, block, hold, escalate, reject."
                        ),
                    },
                    "target": {
                        "type": "string",
                        "description": "Who/what it acts on, e.g. 'warehouse', 'dashboard'.",
                    },
                    "display": {
                        "type": "string",
                        "description": "Readable phrasing, e.g. 'Alert the warehouse team'.",
                    },
                },
                "required": ["type", "target", "display"],
            },
        },
        "priority": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["name", "trigger", "trigger_type", "conditions", "actions", "priority"],
}

PARSE_SYSTEM = """You convert plain-English business automation rules into structured JSON.

Rules:
- Split compound actions into separate action entries (e.g. "alert warehouse and flag on
  dashboard" becomes two actions).
- Use hours_since_update (a number of hours) for any "stays in X for N hours/days" phrasing;
  convert days to hours.
- Use amount for money. Strip currency symbols and separators.
- "display" fields are shown directly to a business user, so keep them short and readable.
- Choose the trigger_type enum value that best matches the described event."""


@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL, "workflows": len(db.list_workflows())}


@app.get("/api/stats")
def get_stats():
    return STATS


# --- Beat 1: parse ---------------------------------------------------------
@app.post("/api/parse")
def parse_rule(req: ParseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Describe a rule first.")

    try:
        response = gemini().models.generate_content(
            model=MODEL,
            contents=req.text.strip(),
            config=types.GenerateContentConfig(
                system_instruction=PARSE_SYSTEM,
                max_output_tokens=2000,
                response_mime_type="application/json",
                response_schema=PARSE_SCHEMA,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=gemini_error(exc))

    STATS["llm_calls"] += 1

    text = response.text
    if not text:
        raise HTTPException(status_code=502, detail="Gemini returned no parsable content.")

    parsed = json.loads(text)
    parsed["source_system"] = req.source_system
    parsed["raw_text"] = req.text.strip()
    parsed["status"] = "draft"
    return {"workflow": parsed, "llm_calls": STATS["llm_calls"]}


# --- Beat 2: simulate (pure Python) ----------------------------------------
@app.post("/api/simulate")
def simulate_rule(req: SimulateRequest):
    result = engine.simulate(req.workflow)
    workflow_id = req.workflow.get("id")
    if workflow_id is not None:
        db.update_last_match_count(workflow_id, result["matched"])
    STATS["rules_evaluated"] += result["evaluations"]
    STATS["simulations_run"] += 1
    result["llm_calls_used"] = 0  # simulation is pure Python
    return result


@app.get("/api/health-score")
def health_score():
    workflows = [w for w in db.list_workflows() if w.get("status", "active") == "active"]
    conflicts = engine.detect_conflicts(workflows)
    return engine.calculate_health_score(workflows, conflicts)


# --- Beat 3: persist -------------------------------------------------------
@app.get("/api/workflows")
def get_workflows():
    return {"workflows": db.list_workflows()}


@app.post("/api/workflows")
def create_workflow(req: WorkflowRequest):
    wf = dict(req.workflow)
    wf["status"] = "active"
    if not wf.get("trigger"):
        raise HTTPException(status_code=400, detail="Parse a rule before deploying it.")
    saved = db.insert_workflow(wf)
    all_workflows = db.list_workflows()
    conflict_result = engine.detect_conflicts(all_workflows)
    workflow_id = saved["id"]
    conflicts = [
        conflict for conflict in conflict_result["conflicts"]
        if conflict["rule_a"].get("id") == workflow_id
        or conflict["rule_b"].get("id") == workflow_id
    ]
    CONFLICTS_BY_WORKFLOW[workflow_id] = conflicts
    return {
        "workflow": saved,
        "conflicts_detected": len(conflicts),
        "conflicts": conflicts,
    }


@app.delete("/api/workflows/{workflow_id}")
def remove_workflow(workflow_id: int):
    if not db.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="No such workflow.")
    CONFLICTS_BY_WORKFLOW.pop(workflow_id, None)
    return {"deleted": workflow_id}


@app.post("/api/reset")
def reset_demo():
    """Re-seed the DB so the demo can be run again from a clean slate."""
    seeded = db.init_db(force_reseed=True)
    for key in STATS:
        STATS[key] = 0
    CONFLICTS_BY_WORKFLOW.clear()
    return {"reseeded": seeded, "workflows": db.list_workflows()}


# --- Beat 4: conflicts (pure Python) ---------------------------------------
@app.post("/api/conflicts")
def scan_conflicts():
    result = engine.detect_conflicts(db.list_workflows())
    for conflict in result["conflicts"]:
        conflict["affected"] = engine.count_affected(conflict)
    STATS["conflict_scans"] += 1
    STATS["pairs_compared"] += result["pairs_compared"]
    result["llm_calls_used"] = 0  # detection is pure Python
    return result


RESOLVE_SYSTEM = """You are a business rules conflict resolver. You receive two conflicting
automation rules and must propose a precise fix. Always respond in valid
JSON only — no explanation, no markdown."""


@app.post("/api/resolve-conflict")
def resolve_conflict(req: ResolveRequest):
    a, b = req.rule_a, req.rule_b
    prompt = f"""These two rules conflict in the range where their conditions overlap.

Rule A (id: {a.get('id')}):
- Name: {a.get('name')}
- Trigger: {a.get('trigger_type')}
- Conditions: {json.dumps(a.get('conditions', []))}
- Actions: {json.dumps(a.get('actions', []))}
- Priority: {a.get('priority')}

Rule B (id: {b.get('id')}):
- Name: {b.get('name')}
- Trigger: {b.get('trigger_type')}
- Conditions: {json.dumps(b.get('conditions', []))}
- Actions: {json.dumps(b.get('actions', []))}
- Priority: {b.get('priority')}

Propose a fix. Respond ONLY with this JSON structure:
{{
  "explanation": "<one sentence describing the conflict>",
  "winning_rule_id": "<id of rule that should take priority>",
  "fix": {{
    "rule_id": "<id of rule to modify>",
    "field": "<'conditions' or 'priority'>",
    "current_value": "<what it is now>",
    "suggested_value": "<what it should be changed to>",
    "reason": "<one sentence why>"
  }}
}}"""
    try:
        response = gemini().models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=RESOLVE_SYSTEM,
                max_output_tokens=800,
                response_mime_type="application/json",
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=gemini_error(exc))

    text = response.text.strip()
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Gemini returned invalid resolver JSON.")
    STATS["llm_calls"] += 1
    return result


@app.post("/api/apply-fix")
def apply_fix(req: ApplyFixRequest):
    fix = req.fix
    field = fix.get("field")
    value = fix.get("suggested_value")
    if field == "conditions" and isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Suggested conditions must be valid JSON.")
    if not db.update_workflow_field(fix.get("rule_id"), field, value):
        raise HTTPException(status_code=400, detail="Could not apply the suggested fix.")
    return {"workflow": next(w for w in db.list_workflows() if w["id"] == fix["rule_id"])}


EXPLAIN_SYSTEM = """You explain automation rule conflicts to a business operations manager.

Write exactly two short paragraphs, no headings, no markdown, no bullet points:
1. What the conflict is and what actually happens to records caught in the overlap.
2. A concrete recommended resolution naming which rule to change and how.

Be specific about the numbers involved. Stay under 90 words total."""


@app.post("/api/explain-conflict")
def explain_conflict(req: ExplainRequest):
    c = req.conflict
    a, b = c.get("rule_a", {}), c.get("rule_b", {})

    def describe(rule):
        conds = "; ".join(x.get("display", "") for x in rule.get("conditions", []))
        acts = "; ".join(x.get("display", "") for x in rule.get("actions", []))
        return (
            f"Rule \"{rule.get('name')}\" (source: {rule.get('source_system')}, "
            f"priority: {rule.get('priority')})\n"
            f"  Trigger: {rule.get('trigger')}\n"
            f"  Conditions: {conds}\n"
            f"  Actions: {acts}"
        )

    affected = c.get("affected") or {}
    affected_line = ""
    if affected.get("count"):
        affected_line = (
            f"\nRight now {affected['count']} live record(s) fall in this overlap: "
            f"{', '.join(str(i) for i in affected.get('ids', []))}."
        )

    prompt = (
        f"{describe(a)}\n\n{describe(b)}\n\n"
        f"Detected overlap: {c.get('overlap_label')}.{affected_line}"
    )

    try:
        response = gemini().models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=EXPLAIN_SYSTEM,
                max_output_tokens=600,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=gemini_error(exc))

    STATS["llm_calls"] += 1
    STATS["conflict_llm_calls"] += 1

    explanation = response.text.strip()
    return {"explanation": explanation, "llm_calls": STATS["llm_calls"]}
