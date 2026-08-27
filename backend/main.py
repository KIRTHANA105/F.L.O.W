"""FLOW - AI-Powered Business Automation Copilot (backend)."""
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import capabilities as cap
import db
import engine
import llm

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

MODEL = "gemini-3.5-flash"

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
    "capabilities_matched": 0,
}

CONFLICTS_BY_WORKFLOW = {}


@app.on_event("startup")
def startup():
    seeded = db.init_db()
    llm.init_cache()
    cached = llm.cache_stats()["total"]
    print(f"[FLOW] database ready at {db.DB_PATH} (seeded {seeded} workflows)")
    print(f"[FLOW] llm cache ready ({cached} recorded responses)")


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
    "customer_created",
    "employee_created",
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
        "capabilities": {
            "type": "array",
            "description": (
                "Which capabilities this rule needs, chosen ONLY from the allowed list. "
                "One entry per distinct unit of work the rule performs."
            ),
            "items": {"type": "string", "enum": cap.KEYS},
        },
        "department": {
            "type": "string",
            "enum": ["HR", "Finance", "Sales", "IT", "Support", "Ops"],
        },
    },
    "required": ["name", "trigger", "trigger_type", "conditions", "actions", "priority",
                 "capabilities", "department"],
}

PARSE_SYSTEM = """You convert plain-English business automation rules into structured JSON.

Rules:
- Split compound actions into separate action entries (e.g. "alert warehouse and flag on
  dashboard" becomes two actions).
- Use hours_since_update (a number of hours) for any "stays in X for N hours/days" phrasing;
  convert days to hours.
- Use amount for money. Strip currency symbols and separators.
- "display" fields are shown directly to a business user, so keep them short and readable.
- Choose the trigger_type enum value that best matches the described event.
- "capabilities" must come from the allowed enum only. Pick one per distinct unit of
  work: "create a CRM record, notify sales, assign a senior rep" is three capabilities.
- "department" is the team that owns this rule.

Available record fields, and what they mean:
- status              text  - e.g. packed, pending, submitted, new, active
- hours_since_update  number - hours since the record last changed
- amount              number - money value (order value, invoice total, deal size)
- customer / vendor   text  - the party's NAME. Never use these for value judgements.
- warehouse           text  - location code

Map vague business language onto these fields numerically. "High-value",
"large", or "big" means amount above a threshold - use amount > 50000 unless the
user gives a number. Never invent a field, and never put a describing word like
"high-value" into a name field."""


@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL, "workflows": len(db.list_workflows())}


class DemoModeRequest(BaseModel):
    enabled: bool


@app.get("/api/demo-mode")
def get_demo_mode():
    """Safety mode state plus what is available to serve from cache."""
    return {
        "safety_mode": llm.safety_mode(),
        "cache": llm.cache_stats(),
        "counters": llm.COUNTERS,
    }


@app.post("/api/demo-mode")
def set_demo_mode(req: DemoModeRequest):
    """Flip Demo Safety Mode - recorded responses only, no network calls."""
    enabled = llm.set_safety_mode(req.enabled)
    return {
        "safety_mode": enabled,
        "cache": llm.cache_stats(),
        "counters": llm.COUNTERS,
    }


@app.get("/api/stats")
def get_stats():
    """Session counters plus the cache/quota picture behind them."""
    return {
        **STATS,
        "live_llm_calls": llm.COUNTERS["live_calls"],
        "cached_llm_calls": llm.COUNTERS["cache_hits"] + llm.COUNTERS["safety_hits"],
        "safety_mode": llm.safety_mode(),
    }


# --- Beat 1: parse ---------------------------------------------------------
@app.post("/api/parse")
def parse_rule(req: ParseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Describe a rule first.")

    try:
        text = llm.llm_call(
            "parse",
            req.text.strip(),
            system=PARSE_SYSTEM,
            schema=PARSE_SCHEMA,
            max_tokens=2000,
        )
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail="The model's response was not valid JSON. Try parsing again.",
        )
    parsed["source_system"] = req.source_system
    parsed["raw_text"] = req.text.strip()
    parsed["status"] = "draft"

    # Memory match: what does the company already provide? (pure Python)
    delta = engine.compute_delta(parsed.get("capabilities", []), db.capability_map())
    for item in delta["reused"] + delta["new"]:
        item["description"] = cap.describe(item["capability"])
    STATS["capabilities_matched"] += delta["reuse_count"]

    # Policy check: pure Python, IR vs compiled policy rules.
    policy_result = engine.check_policies(parsed, db.list_policies(active_only=True))

    return {
        "workflow": parsed,
        "memory_match": delta,
        "policy_check": policy_result,
        "llm_calls": STATS["llm_calls"],
    }


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
POLICY_SYSTEM = """You compile plain-English business policies into checkable JSON.

Pick exactly one "type":
- "forbid": the policy bans an action. Set forbid_capability. If it only applies
  alongside another action, set when_capability.
- "require_approval_above": the policy demands sign-off past a money threshold.
  Set field ("amount"), threshold (number), approver, and applies_to (capabilities).

Capabilities must come from the allowed list. Keep "text" as the original sentence."""

POLICY_SCHEMA = {
    "type": "object",
    "properties": {
        "department": {
            "type": "string",
            "enum": ["HR", "Finance", "Sales", "IT", "Support", "Ops"],
        },
        "type": {
            "type": "string",
            "enum": ["forbid", "require_approval_above"],
        },
        "forbid_capability": {"type": "string", "enum": cap.KEYS + [""]},
        "when_capability": {"type": "string", "enum": cap.KEYS + [""]},
        "field": {"type": "string"},
        "threshold": {"type": "number"},
        "approver": {"type": "string"},
        "applies_to": {"type": "array", "items": {"type": "string", "enum": cap.KEYS}},
    },
    "required": ["department", "type"],
}


class PolicyRequest(BaseModel):
    text: str


class PolicyActiveRequest(BaseModel):
    active: bool


@app.get("/api/policies")
def get_policies():
    policies = db.list_policies()
    return {
        "policies": policies,
        "active_count": sum(1 for p in policies if p["active"]),
    }


@app.post("/api/policies")
def create_policy(req: PolicyRequest):
    """Compile one plain-English policy line into a checkable rule."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write a policy first.")
    try:
        compiled = llm.llm_json(
            "compile-policy",
            text,
            system=POLICY_SYSTEM,
            schema=POLICY_SCHEMA,
            max_tokens=1000,
        )
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1
    department = compiled.pop("department", "Ops")
    compiled = {k: v for k, v in compiled.items() if v not in ("", None, [])}
    return {"policy": db.insert_policy(text, department, compiled)}


@app.patch("/api/policies/{policy_id}")
def toggle_policy(policy_id: int, req: PolicyActiveRequest):
    if not db.set_policy_active(policy_id, req.active):
        raise HTTPException(status_code=404, detail="No such policy.")
    return {"policy": db.get_policy(policy_id)}


@app.delete("/api/policies/{policy_id}")
def remove_policy(policy_id: int):
    if not db.delete_policy(policy_id):
        raise HTTPException(status_code=404, detail="No such policy.")
    return {"deleted": policy_id}


@app.get("/api/memory")
def get_memory():
    """The Business Process Memory: workflows, capabilities, policies, links."""
    cmap = db.capability_map()
    workflows = db.list_workflows()
    policies = db.list_policies()

    capabilities = [
        {
            "key": key,
            "description": cap.describe(key),
            "providers": providers,
            "shared": len({p["department"] for p in providers}) > 1,
        }
        for key, providers in sorted(cmap.items())
    ]
    shared = {c["key"] for c in capabilities if c["shared"]}

    # Department-grouped tree - the primary BPM Explorer view.
    departments = {}
    for wf in workflows:
        dept = wf.get("department") or "Ops"
        entry = departments.setdefault(
            dept, {"department": dept, "workflows": [], "capabilities": set()}
        )
        wf_caps = wf.get("capabilities") or []
        entry["workflows"].append({
            "id": wf["id"],
            "name": wf["name"],
            "source_system": wf["source_system"],
            "trigger": wf["trigger"],
            "status": wf["status"],
            "capabilities": [
                {
                    "key": k,
                    "description": cap.describe(k),
                    "shared": k in shared,
                }
                for k in wf_caps
            ],
            "governed_by": [
                {"id": p["id"], "text": p["text"]}
                for p in policies
                if p["active"] and _policy_touches(p, wf_caps)
            ],
        })
        entry["capabilities"].update(wf_caps)

    tree = []
    for dept in sorted(departments):
        entry = departments[dept]
        tree.append({
            "department": dept,
            "workflow_count": len(entry["workflows"]),
            "capability_count": len(entry["capabilities"]),
            "workflows": entry["workflows"],
        })

    return {
        "tree": tree,
        "capabilities": capabilities,
        "capability_count": len(cmap),
        "registry_size": len(cap.KEYS),
        "workflow_count": len(workflows),
        "policy_count": sum(1 for p in policies if p["active"]),
        "shared_count": len(shared),
    }


def _policy_touches(policy, wf_caps):
    """Does this policy govern a workflow providing these capabilities?"""
    rule = policy.get("compiled") or {}
    keys = set(wf_caps)
    if rule.get("forbid_capability") in keys:
        return True
    if rule.get("when_capability") in keys:
        return True
    return bool(keys & set(rule.get("applies_to") or []))


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
JSON only — no explanation, no markdown.

Write `explanation` and `reason` for a business manager: refer to rules by their
NAME in quotes, never by id number, and never mention database ids.

For `suggested_value` when field is "conditions", return the FULL replacement
conditions array as a JSON array. Keep it short."""

# Schema-constrained so the resolver can't return prose where an object belongs.
RESOLVE_SCHEMA = {
    "type": "object",
    "properties": {
        "explanation": {
            "type": "string",
            "description": "One sentence describing the conflict. Under 30 words.",
        },
        "winning_rule_id": {
            "type": "integer",
            "description": "id of the rule that should take priority.",
        },
        "fix": {
            "type": "object",
            "properties": {
                "rule_id": {"type": "integer", "description": "id of the rule to modify"},
                "field": {"type": "string", "enum": ["conditions", "priority"]},
                "current_value": {"type": "string", "description": "Readable current state."},
                "suggested_value": {
                    "type": "string",
                    "description": (
                        "For field=conditions: the full replacement array as a JSON "
                        "string. For field=priority: low, medium, or high."
                    ),
                },
                "reason": {"type": "string", "description": "One sentence why. Under 25 words."},
            },
            "required": ["rule_id", "field", "current_value", "suggested_value", "reason"],
        },
    },
    "required": ["explanation", "winning_rule_id", "fix"],
}


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
        # Cache on the rules' semantics, not their ids: ids change on every
        # reseed, and a demo re-run must still hit the recorded response.
        cache_on = json.dumps(
            {
                "a": [a.get("name"), a.get("trigger_type"),
                      a.get("conditions"), a.get("actions")],
                "b": [b.get("name"), b.get("trigger_type"),
                      b.get("conditions"), b.get("actions")],
            },
            sort_keys=True,
        )
        result = llm.llm_json(
            "resolve-conflict",
            prompt,
            system=RESOLVE_SYSTEM,
            schema=RESOLVE_SCHEMA,
            max_tokens=2000,
            cache_on=cache_on,
        )
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # A cached suggestion can carry stale ids (they change on every reseed).
    # Stamp the target's NAME so apply-fix can find the right current row.
    fix = result.get("fix") or {}
    target = next((r for r in (a, b) if r.get("id") == fix.get("rule_id")), None)

    if target is None:
        # The id came from a cached suggestion and no longer exists. Pick the
        # rule whose CURRENT conditions the suggestion replaces - never guess,
        # because patching the wrong rule inverts its meaning.
        current = str(fix.get("current_value") or "")
        for rule in (a, b):
            if any(c.get("display") and c["display"] in current
                   for c in rule.get("conditions", [])):
                target = rule
                break

    if target is None:
        raise HTTPException(
            status_code=502,
            detail=(
                "The suggested fix does not match either rule as they stand now. "
                "Re-scan for conflicts and try again."
            ),
        )

    fix["rule_name"] = target.get("name")
    fix["rule_id"] = target.get("id")

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
    # Resolve the target by name when possible: ids shift across reseeds, and
    # patching the wrong rule mid-demo is worse than failing loudly.
    workflows = db.list_workflows()
    target = None
    name = fix.get("rule_name")
    if name:
        target = next((w for w in workflows if w["name"] == name), None)
    if target is None:
        target = next((w for w in workflows if w["id"] == fix.get("rule_id")), None)
    if target is None:
        raise HTTPException(
            status_code=400,
            detail="The rule this fix targets no longer exists. Re-scan for conflicts.",
        )

    if not db.update_workflow_field(target["id"], field, value):
        raise HTTPException(status_code=400, detail="Could not apply the suggested fix.")
    return {"workflow": next(w for w in db.list_workflows() if w["id"] == target["id"])}


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
        explanation = llm.llm_call(
            "explain-conflict",
            prompt,
            system=EXPLAIN_SYSTEM,
            max_tokens=600,
            json_out=False,
        ).strip()
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    STATS["llm_calls"] += 1
    STATS["conflict_llm_calls"] += 1

    return {"explanation": explanation, "llm_calls": STATS["llm_calls"]}
