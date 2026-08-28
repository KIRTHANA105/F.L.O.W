"""Pure-Python graph reasoning: does a proposed workflow fit the existing
process architecture? No LLM in this file - the LLM only turns English into
a proposed workflow (main.py) and turns a verdict into a sentence (main.py).
This module decides, deterministically, what the verdict actually is.

Reasoning happens at the WORKFLOW level, not by flattening every step into
one global list. Step names repeat across workflows on purpose (a workflow
often restates its own precondition, e.g. Onboarding starts by re-stating
"Finance Verification" as a gate) - so identity has to come from which
workflow a step belongs to, not the step name alone.
"""


def find_workflow_by_step(workflows, step_name):
    """Which existing workflow currently OWNS this step (has it as one of its
    own steps, not a restated precondition)? First match wins - seed order
    lists a workflow before anything that quotes its final step as a gate."""
    step_name = (step_name or "").strip().lower()
    for wf in workflows:
        for s in wf.get("steps", []):
            if s["name"].strip().lower() == step_name:
                return wf
    return None


def build_process_path(workflows, dep_map, start_workflow_id):
    """Walk outgoing edges from a workflow to build the linear path judges
    need to see: the sequence of workflows the existing architecture actually
    runs, starting from `start_workflow_id`. Picks the "requires"/"precedes"
    edge over "triggers" when a workflow has more than one outgoing edge,
    since that is the path a record actually flows down by default."""
    path = []
    seen = set()
    current = start_workflow_id
    by_id = {w["id"]: w for w in workflows}

    while current is not None and current not in seen:
        seen.add(current)
        wf = by_id.get(current)
        if wf is None:
            break
        path.append(wf)
        outgoing = dep_map["outgoing"].get(current, [])
        if not outgoing:
            current = None
        else:
            preferred = next((e for e in outgoing if e["relationship"] in ("requires", "precedes")), outgoing[0])
            current = preferred["workflow_id"]

    return path


def workflows_between(existing_path, from_wf_id, to_wf_id):
    """The workflow nodes strictly between two points on a path (exclusive)."""
    ids = [w["id"] for w in existing_path]
    if from_wf_id not in ids or to_wf_id not in ids:
        return []
    i, j = ids.index(from_wf_id), ids.index(to_wf_id)
    if i >= j:
        return []
    return existing_path[i + 1:j]


def find_workflow_containing_target(workflows, dep_map, origin_wf, target_step):
    """Where does `target_step` actually live in the graph reachable from
    origin_wf? Search origin_wf's own steps first (a same-workflow jump isn't
    a graph skip), then everything downstream."""
    target = (target_step or "").strip().lower()

    for s in origin_wf.get("steps", []):
        if s["name"].strip().lower() == target:
            return origin_wf  # same workflow - not a cross-process skip

    visited = set()
    frontier = [e["workflow_id"] for e in dep_map["outgoing"].get(origin_wf["id"], [])]
    by_id = {w["id"]: w for w in workflows}
    while frontier:
        wf_id = frontier.pop(0)
        if wf_id in visited:
            continue
        visited.add(wf_id)
        wf = by_id.get(wf_id)
        if wf is None:
            continue
        for s in wf.get("steps", []):
            if s["name"].strip().lower() == target:
                return wf
        frontier.extend(e["workflow_id"] for e in dep_map["outgoing"].get(wf_id, []))
    return None


def _is_email_step(step):
    name = (step.get("name") or "").lower()
    op = (step.get("operation_id") or "").lower()
    app = (step.get("app") or "").lower()
    act = (step.get("action") or "").lower()
    if op in ("gmail.send", "email.send", "sendgrid.send", "outlook.send"):
        return True
    if app in ("gmail", "sendgrid", "outlook", "mailchimp"):
        return True
    if act in ("send_email", "send_mail"):
        return True
    # If op is another app like slack.post, sheets.append, it is NOT an email step even if label has word email
    if op and not any(k in op for k in ("gmail", "email", "mail", "sendgrid")):
        return False
    return name in ("send email", "send an email", "email customer", "send notification email") or (
        "email" in name and not any(k in name for k in ("slack", "sheet", "database", "crm", "post to"))
    )


def _is_refund_step(step):
    name = (step.get("name") or "").lower()
    op = (step.get("operation_id") or "").lower()
    app = (step.get("app") or "").lower()
    act = (step.get("action") or "").lower()
    if op in ("stripe.refund", "payment.refund", "charge.refund"):
        return True
    if act in ("refund", "process_refund", "issue_refund"):
        return True
    if "refund" in name and not any(k in name for k in ("request", "form", "ask", "initiate")):
        return True
    return False


def _is_opt_out_guard(step):
    name = (step.get("name") or "").lower()
    cond = str(step.get("condition") or step.get("guard") or "").lower()
    step_type = (step.get("type") or "").lower()
    text_check = f"{name} {cond}"
    return "opted_out" in text_check or "opt_out" in text_check or "unsubscribe" in text_check or "subscription_status" in text_check


def _is_approval_step(step):
    name = (step.get("name") or "").lower()
    step_type = (step.get("type") or "").lower()
    return "approval" in name or "approve" in name or step_type in ("approval", "human_approval", "manual_review")


def check_intra_workflow_policies(proposed, policy_rules):
    """Inspects step operations, condition guards, and approval gates within the workflow."""
    steps = proposed.get("steps") or []
    violated = []

    has_opt_out_guard = any(_is_opt_out_guard(s) for s in steps)
    has_approval = any(_is_approval_step(s) for s in steps)

    for rule in policy_rules:
        if not rule.get("active", True):
            continue
        compiled = rule.get("compiled") or {}
        c_type = compiled.get("type")
        rule_text = (rule.get("text") or "").lower()

        # Policy Type 1: Email Opt-Out Guard Required
        if c_type == "require_guard" and compiled.get("field") in ("opted_out", "opt_out") or (
            "email" in rule_text and ("opted_out" in rule_text or "unsubscribed" in rule_text or "opt_out" in rule_text)
        ):
            has_email = any(_is_email_step(s) for s in steps)
            if has_email and not has_opt_out_guard:
                violated.append({
                    **rule,
                    "reason": "Workflow sends email without verifying contact opt-out / subscription status.",
                    "required_guard": "opted_out == false",
                })

        # Policy Type 2: High Value / Unbounded Refund Approval Required
        elif c_type in ("require_approval", "require_approval_above") or (
            "refund" in rule_text and ("approval" in rule_text or "approve" in rule_text or "human" in rule_text)
        ):
            has_refund = any(_is_refund_step(s) for s in steps)
            if has_refund and not has_approval:
                violated.append({
                    **rule,
                    "reason": "Financial refund step executed without human approval gate.",
                    "required_guard": "human_approval step before refund",
                })

    return violated


def evaluate_proposal(proposed, workflows, dep_map, policy_rules):
    """The core reasoning: does `proposed` fit the existing architecture and policies?
    Checks:
      1. Intra-workflow field & condition guards (email opt-out, refund approval, etc.)
      2. Inter-workflow architectural ordering & skipped policy-required workflows.
    """
    steps = [s["name"] for s in proposed.get("steps", [])]
    origin_name = (proposed.get("origin_step") or (steps[0] if steps else "")).strip()
    target_step = steps[1] if len(steps) > 1 else None

    # 1. Intra-workflow policy check
    intra_violated = check_intra_workflow_policies(proposed, policy_rules)

    origin_wf = find_workflow_by_step(workflows, origin_name)
    if origin_wf is None:
        if intra_violated:
            rule = intra_violated[0]
            return {
                "status": "conflict",
                "origin_workflow": None,
                "target_workflow": None,
                "existing_path": [],
                "skipped_workflows": [],
                "violated_rules": intra_violated,
                "reasoning": f"Workflow violates company policy: \"{rule.get('text')}\" - {rule.get('reason', '')}",
            }
        return {
            "status": "compatible",
            "origin_workflow": None,
            "target_workflow": None,
            "existing_path": [],
            "skipped_workflows": [],
            "violated_rules": [],
            "reasoning": (
                f'"{origin_name}" was not found anywhere in the existing process '
                f"memory, so this workflow doesn't attach to a known process. "
                f"It will be tracked as a new, independent workflow."
            ),
        }

    existing_path = build_process_path(workflows, dep_map, origin_wf["id"])

    if not target_step:
        if intra_violated:
            rule = intra_violated[0]
            return {
                "status": "conflict",
                "origin_workflow": origin_wf,
                "target_workflow": None,
                "existing_path": existing_path,
                "skipped_workflows": [],
                "violated_rules": intra_violated,
                "reasoning": f"Workflow violates company policy: \"{rule.get('text')}\" - {rule.get('reason', '')}",
            }
        return {
            "status": "compatible",
            "origin_workflow": origin_wf,
            "target_workflow": None,
            "existing_path": existing_path,
            "skipped_workflows": [],
            "violated_rules": [],
            "reasoning": _compatible_reasoning(origin_name, origin_wf, existing_path),
        }

    target_wf = find_workflow_containing_target(workflows, dep_map, origin_wf, target_step)

    skipped_workflows = []
    if target_wf is not None and target_wf["id"] != origin_wf["id"]:
        skipped_workflows = workflows_between(existing_path, origin_wf["id"], target_wf["id"])

    inter_violated = []
    if skipped_workflows:
        skipped_names = {wf["name"] for wf in skipped_workflows}
        for rule in policy_rules:
            if not rule.get("active", True):
                continue
            compiled = rule.get("compiled") or {}
            if compiled.get("type") != "require_precedes":
                continue
            required_workflow = compiled.get("required_workflow")
            before = compiled.get("before_step")
            if required_workflow in skipped_names and before == target_step:
                inter_violated.append(rule)

    all_violated = intra_violated + inter_violated

    if all_violated:
        if intra_violated:
            rule = intra_violated[0]
            reasoning = f"Workflow violates company policy: \"{rule.get('text')}\" - {rule.get('reason', '')}"
        else:
            reasoning = _conflict_reasoning(origin_name, target_step, skipped_workflows, inter_violated)
        return {
            "status": "conflict",
            "origin_workflow": origin_wf,
            "target_workflow": target_wf,
            "existing_path": existing_path,
            "skipped_workflows": skipped_workflows,
            "violated_rules": all_violated,
            "reasoning": reasoning,
        }

    if skipped_workflows:
        return {
            "status": "warning",
            "origin_workflow": origin_wf,
            "target_workflow": target_wf,
            "existing_path": existing_path,
            "skipped_workflows": skipped_workflows,
            "violated_rules": [],
            "reasoning": _warning_reasoning(origin_name, target_step, skipped_workflows),
        }

    return {
        "status": "compatible",
        "origin_workflow": origin_wf,
        "target_workflow": target_wf,
        "existing_path": existing_path,
        "skipped_workflows": [],
        "violated_rules": [],
        "reasoning": _compatible_reasoning(origin_name, origin_wf, existing_path),
    }


def _conflict_reasoning(origin_name, target_step, skipped_workflows, violated):
    skip_names = ", ".join(wf["name"] for wf in skipped_workflows)
    rule = violated[0]
    return (
        f'In the existing architecture, "{origin_name}" leads to {skip_names} '
        f'before reaching "{target_step}". This is enforced by policy: '
        f'"{rule["text"]}" The proposed workflow jumps from "{origin_name}" '
        f'directly to "{target_step}", bypassing {skip_names}.'
    )


def _warning_reasoning(origin_name, target_step, skipped_workflows):
    skip_names = ", ".join(wf["name"] for wf in skipped_workflows)
    return (
        f'The existing architecture normally runs {skip_names} between '
        f'"{origin_name}" and "{target_step}". No policy explicitly forbids '
        f"skipping this, but it differs from how the process runs today."
    )


def _compatible_reasoning(origin_name, origin_wf, existing_path):
    names = " -> ".join(wf["name"] for wf in existing_path[:4])
    return (
        f'"{origin_name}" already exists in the process memory as part of '
        f"{names}. The proposed workflow continues from a point the existing "
        f"architecture already reaches, without skipping any required step or "
        f"policy check."
    )


def affected_departments(existing_path):
    seen = []
    for wf in existing_path:
        if wf["department"] not in seen:
            seen.append(wf["department"])
    return seen
