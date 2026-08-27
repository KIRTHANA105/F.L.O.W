"""Pure-Python rule evaluation and conflict detection. No LLM calls here."""
import json
import os

MOCK_DIR = os.path.join(os.path.dirname(__file__), "mock_data")

# Which dataset a trigger type simulates against.
DATASET_FOR_TRIGGER = {
    "invoice_submitted": "invoices",
    "order_status_change": "orders",
    "order_created": "orders",
    "shipment_created": "orders",
    "payment_received": "invoices",
    "customer_created": "customers",
    "employee_created": "employees",
}

# Each dataset's primary key and the label shown above it in the results table.
DATASET_META = {
    "orders": ("order_id", "Order ID", "orders"),
    "invoices": ("invoice_id", "Invoice ID", "invoices"),
    "customers": ("customer_id", "Customer ID", "customers"),
    "employees": ("employee_id", "Employee ID", "employees"),
}


def load_dataset(name):
    with open(os.path.join(MOCK_DIR, f"{name}.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def dataset_for(trigger_type):
    return DATASET_FOR_TRIGGER.get(trigger_type, "orders")


def _coerce(value):
    """Best-effort numeric coercion so '48' and 48 compare the same."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        stripped = value.replace(",", "").strip()
        try:
            return float(stripped)
        except ValueError:
            return value.strip().lower()
    return value


def evaluate_condition(record, cond):
    """Evaluate one condition against one record. Returns (passed, detail)."""
    field = cond.get("field", "")
    op = (cond.get("operator") or "equals").strip()
    expected = _coerce(cond.get("value"))

    if field not in record:
        return False, f"no field '{field}'"

    actual = _coerce(record[field])

    # Comparing a number against text can't succeed; report it rather than crash.
    if op in {">", ">=", "<", "<="} and not (
        isinstance(actual, (int, float)) and isinstance(expected, (int, float))
    ):
        return False, f"{field}={record[field]} not comparable"

    try:
        if op == ">":
            passed = actual > expected
        elif op == ">=":
            passed = actual >= expected
        elif op == "<":
            passed = actual < expected
        elif op == "<=":
            passed = actual <= expected
        elif op in ("!=", "not_equals"):
            passed = actual != expected
        elif op == "contains":
            passed = str(expected) in str(actual)
        else:  # equals and anything unrecognised
            passed = actual == expected
    except TypeError:
        return False, "incomparable values"

    return passed, f"{field}={record[field]}"


def simulate(workflow, dataset_name=None):
    """Run a parsed workflow's conditions against mock records."""
    trigger_type = workflow.get("trigger_type", "other")
    dataset_name = dataset_name or dataset_for(trigger_type)
    records = load_dataset(dataset_name)
    conditions = workflow.get("conditions", []) or []

    id_key, id_label, noun = DATASET_META.get(dataset_name, ("order_id", "Order ID", "orders"))
    results = []
    evaluations = 0

    for rec in records:
        details = []
        matched = True
        for cond in conditions:
            passed, detail = evaluate_condition(rec, cond)
            evaluations += 1
            fallback = f"{cond.get('field')} {cond.get('operator')} {cond.get('value')}"
            details.append({
                "condition": cond.get("display") or fallback,
                "passed": passed,
                "detail": detail,
            })
            if not passed:
                matched = False
        # A rule with no conditions shouldn't silently match everything.
        if not conditions:
            matched = False

        results.append({
            "record_id": rec.get(id_key, "-"),
            "status": rec.get("status", "-"),
            "hours_since_update": rec.get("hours_since_update"),
            "amount": rec.get("amount"),
            "matched": matched,
            "checks": details,
        })

    match_count = sum(1 for r in results if r["matched"])
    return {
        "dataset": dataset_name,
        "id_label": id_label,
        "total": len(records),
        "matched": match_count,
        "evaluations": evaluations,
        "summary": f"This rule would have fired on {match_count} out of {len(records)} {noun}",
        "results": results,
    }


# --- Conflict detection ----------------------------------------------------
PERMISSIVE = {"approve", "auto-approve", "auto_approve", "allow", "accept", "release", "proceed"}
RESTRICTIVE = {"flag", "block", "hold", "reject", "deny", "escalate", "review", "manual"}


def action_stance(actions):
    """Classify a rule's actions as permissive, restrictive, mixed, or neutral."""
    text = " ".join(
        f"{a.get('type', '')} {a.get('display', '')} {a.get('target', '')}"
        for a in (actions or [])
    ).lower()
    permissive = any(w in text for w in PERMISSIVE)
    restrictive = any(w in text for w in RESTRICTIVE)
    if permissive and not restrictive:
        return "permissive"
    if restrictive and not permissive:
        return "restrictive"
    if permissive and restrictive:
        return "mixed"
    return "neutral"


def numeric_range(conditions, field):
    """Collapse conditions on one numeric field into a (low, high) interval."""
    low, high = float("-inf"), float("inf")
    seen = False
    for cond in conditions or []:
        if cond.get("field") != field:
            continue
        val = _coerce(cond.get("value"))
        if not isinstance(val, (int, float)):
            continue
        op = (cond.get("operator") or "").strip()
        if op in (">", ">="):
            low = max(low, val)
            seen = True
        elif op in ("<", "<="):
            high = min(high, val)
            seen = True
        elif op in ("equals", "=="):
            low = max(low, val)
            high = min(high, val)
            seen = True
    return (low, high) if seen else None


def _fmt(n):
    if n == float("-inf"):
        return "any"
    if n == float("inf"):
        return "any"
    return f"{int(n):,}" if float(n).is_integer() else f"{n:,}"


def numeric_fields(conditions):
    out = set()
    for c in conditions or []:
        if c.get("field") and isinstance(_coerce(c.get("value")), (int, float)):
            out.add(c["field"])
    return out


def _verb(stance):
    return "approves" if stance == "permissive" else "blocks"


def detect_conflicts(workflows):
    """Pairwise scan: same trigger + overlapping range + contradictory actions."""
    active = [w for w in workflows if w.get("status", "active") == "active"]
    conflicts = []
    pairs = 0

    for i in range(len(active)):
        for j in range(i + 1, len(active)):
            a, b = active[i], active[j]
            pairs += 1

            if a.get("trigger_type") != b.get("trigger_type"):
                continue

            stance_a = action_stance(a.get("actions"))
            stance_b = action_stance(b.get("actions"))
            if {stance_a, stance_b} != {"permissive", "restrictive"}:
                continue

            shared = numeric_fields(a.get("conditions")) & numeric_fields(b.get("conditions"))
            overlap_field, overlap = None, None
            for field in sorted(shared):
                ra = numeric_range(a.get("conditions"), field)
                rb = numeric_range(b.get("conditions"), field)
                if not ra or not rb:
                    continue
                lo, hi = max(ra[0], rb[0]), min(ra[1], rb[1])
                if lo < hi:
                    overlap_field, overlap = field, (lo, hi)
                    break

            if overlap_field is None:
                continue

            lo, hi = overlap
            label = f"{overlap_field} between {_fmt(lo)} and {_fmt(hi)}"
            conflicts.append({
                "id": f"{a['id']}-{b['id']}",
                "severity": "high",
                "trigger_type": a.get("trigger_type"),
                "trigger": a.get("trigger"),
                "overlap_field": overlap_field,
                "overlap_range": [
                    None if lo == float("-inf") else lo,
                    None if hi == float("inf") else hi,
                ],
                "overlap_label": label,
                "reason": (
                    f'Both rules fire on "{a.get("trigger")}" and their conditions '
                    f"overlap when {label}, but one {_verb(stance_a)} while the "
                    f"other {_verb(stance_b)}."
                ),
                "rule_a": a,
                "rule_b": b,
                "stance_a": stance_a,
                "stance_b": stance_b,
            })

    return {
        "pairs_compared": pairs,
        "conflicts_found": len(conflicts),
        "conflicts": conflicts,
        "summary": (
            f"Compared {pairs} rule pairs - found {len(conflicts)} conflict"
            f"{'' if len(conflicts) == 1 else 's'}"
        ),
    }


def count_affected(conflict):
    """How many mock records actually land in the contradictory overlap band."""
    dataset = dataset_for(conflict.get("trigger_type"))
    records = load_dataset(dataset)
    field = conflict.get("overlap_field")
    lo, hi = conflict.get("overlap_range", [None, None])
    lo = float("-inf") if lo is None else lo
    hi = float("inf") if hi is None else hi
    id_key = DATASET_META.get(dataset, ("order_id",))[0]
    ids = []
    for rec in records:
        val = _coerce(rec.get(field))
        if isinstance(val, (int, float)) and lo < val < hi:
            ids.append(rec.get(id_key))
    return {"dataset": dataset, "count": len(ids), "ids": ids}


def calculate_health_score(workflows, conflicts):
    """Calculate a 0-100 health score from active conflicts and orphan rules."""
    active = [w for w in workflows if w.get("status", "active") == "active"]
    conflict_count = len(conflicts.get("conflicts", [])) if isinstance(conflicts, dict) else len(conflicts)
    conflict_penalty = conflict_count * 15
    orphan_penalty = sum(5 for workflow in active if workflow.get("last_match_count", 0) == 0)
    score = max(0, min(100, 100 - conflict_penalty - orphan_penalty))
    return {
        "score": int(score),
        "conflict_penalty": conflict_penalty,
        "orphan_penalty": orphan_penalty,
        "conflict_count": conflict_count,
    }


# --- Memory match / delta computation (pure Python) ------------------------
# This is the differentiator: required capabilities MINUS what the company
# already has = what actually needs building. No LLM involved.
def compute_delta(required, capability_map):
    """Split required capabilities into reused vs. new.

    `capability_map` is {capability_key: [providing workflows]} from the BPM.
    """
    reused, missing = [], []
    for key in required or []:
        providers = capability_map.get(key) or []
        if providers:
            reused.append({"capability": key, "providers": providers})
        else:
            missing.append({"capability": key})

    total = len(required or [])
    return {
        "required": list(required or []),
        "reused": reused,
        "new": missing,
        "reuse_count": len(reused),
        "new_count": len(missing),
        "total": total,
        "summary": (
            f"Building {len(missing)} new action"
            f"{'' if len(missing) == 1 else 's'}. "
            f"Reusing {len(reused)} existing workflow"
            f"{'' if len(reused) == 1 else 's'}."
        ),
        "reuse_pct": round(100 * len(reused) / total) if total else 0,
    }


# --- Policy checking (pure Python, no LLM) ---------------------------------
# The LLM compiles English into a policy structure; it never decides whether a
# workflow passes. That judgement is deterministic code over the compiled rule.
def check_policies(workflow, policies):
    """Check one workflow against every active policy. Returns violations."""
    caps = set(workflow.get("capabilities") or [])
    conditions = workflow.get("conditions") or []
    violations = []
    checked = 0

    for policy in policies:
        if not policy.get("active", True):
            continue
        rule = policy.get("compiled") or {}
        kind = rule.get("type")
        checked += 1

        if kind == "forbid":
            forbidden = rule.get("forbid_capability")
            if forbidden and forbidden in caps:
                # Conditional forbid: only fires alongside another capability.
                trigger_cap = rule.get("when_capability")
                if trigger_cap and trigger_cap not in caps:
                    continue
                # Or gated on a field value the rule itself sets.
                when = rule.get("when")
                if when and not _matches_when(conditions, when):
                    continue
                violations.append({
                    "policy_id": policy.get("id"),
                    "policy_text": policy.get("text"),
                    "department": policy.get("department"),
                    "severity": "block",
                    "detail": (
                        f"This rule provides \"{forbidden}\", which the policy forbids"
                        + (f" when \"{trigger_cap}\" is also present" if trigger_cap else "")
                        + "."
                    ),
                })

        elif kind == "require_approval_above":
            applies = set(rule.get("applies_to") or [])
            if applies and not (caps & applies):
                continue
            threshold = rule.get("threshold")
            field = rule.get("field", "amount")
            reach = _upper_reach(conditions, field)
            if threshold is not None and reach > threshold:
                violations.append({
                    "policy_id": policy.get("id"),
                    "policy_text": policy.get("text"),
                    "department": policy.get("department"),
                    "severity": "warn",
                    "detail": (
                        f"This rule can act on {field} above {int(threshold):,} "
                        f"without {rule.get('approver', 'an approver')} sign-off."
                    ),
                })

    return {
        "policies_checked": checked,
        "violations": violations,
        "passed": len(violations) == 0,
        "summary": (
            f"Checked against {checked} active polic{'y' if checked == 1 else 'ies'} - "
            + ("no violations" if not violations
               else f"{len(violations)} violation{'' if len(violations) == 1 else 's'}")
        ),
    }


def _matches_when(conditions, when):
    field = when.get("field")
    expected = _coerce(when.get("equals"))
    for cond in conditions:
        if cond.get("field") == field and _coerce(cond.get("value")) == expected:
            return True
    return False


def _upper_reach(conditions, field):
    """Highest value of `field` this rule can still act on (inf when uncapped)."""
    rng = numeric_range(conditions, field)
    if rng is None:
        return float("inf")
    return rng[1]
