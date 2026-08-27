"""Post-Creation Simulation Recommendation Engine (SVS Decision Logic).

Evaluates in EXACT priority order:
1. any(catalog[a.operation].side_effect == "irreversible")
     -> SIMULATE, tier DEEP, reason "irreversible_action"
2. workflow.is_modification and parent workflow is active
     -> SIMULATE, tier DEEP, reason "modification_of_live"
3. get_conflicts(workflow_id) is non-empty
     -> SIMULATE, tier DEEP, reason "conflicts_detected"
4. all(catalog[a.operation].side_effect == "read")
     -> DIRECT, reason "read_only_no_writes"
5. otherwise:
     damage    = max(catalog[a.operation].damage for a in actions)
     frequency = {"weekly":1,"daily":2,"hourly":3,"constant":4}[workflow.frequency]
     svs       = damage * frequency
     svs > 20  -> SIMULATE, DEEP,     40 scenarios
     svs >= 5  -> SIMULATE, STANDARD, 12 scenarios
     else      -> SIMULATE, SHALLOW,   3 scenarios

Pure deterministic Python — NO LLM.
"""

from typing import Any, Dict, List, Optional, Union
import catalog
import db
import conflict_detector


def compute_recommendation(workflow_or_id: Union[int, Dict[str, Any]]) -> Dict[str, Any]:
    """Compute SVS decision gate recommendation for a workflow."""
    if isinstance(workflow_or_id, int):
        wf = db.get_workflow(workflow_or_id)
    else:
        wf = workflow_or_id

    if wf is None:
        return {
            "decision": "SIMULATE",
            "tier": "STANDARD",
            "scenario_count": 12,
            "estimated_seconds": 2,
            "reason_code": "workflow_not_found",
            "headline": "Workflow not found; default standard verification recommended.",
            "factors": [
                {"label": "Highest-impact step", "value": "Unknown Action", "level": "medium"},
                {"label": "Runs", "value": "Daily", "level": "medium"},
                {"label": "Writes to", "value": "Internal", "level": "medium"},
                {"label": "Error handling", "value": "1 of 2 unhandled", "level": "medium"},
            ],
        }

    steps = wf.get("steps", [])
    # Action steps are all steps after trigger, or all steps with type=='action', or steps[1:]
    if any(s.get("type") for s in steps):
        action_steps = [s for s in steps if s.get("type") == "action"]
    else:
        action_steps = steps[1:] if len(steps) > 1 else []

    action_infos: List[Dict[str, Any]] = []
    writes_set = set()
    write_apps = set()
    max_damage = 1
    highest_impact_step_name = action_steps[0].get("name", "Process Step") if action_steps else "Read Data"
    damage_source = ""

    for step in action_steps:
        s_name = step.get("name", "").strip()
        s_desc = step.get("description", "").strip()
        s_text = f"{s_name} {s_desc}".lower()
        op_id = step.get("operation_id") or step.get("operation") or ""

        cat_action = catalog.get_action(op_id) if op_id else None
        if not cat_action:
            for act in catalog.ACTIONS:
                if act["operation_id"].lower() == op_id.lower() or act["label"].lower() in s_text or act["operation_id"].lower() in s_text:
                    cat_action = act
                    break

        if cat_action:
            side_effect = cat_action.get("side_effect", "write")
            dmg = cat_action.get("damage", 1)
            writes = cat_action.get("writes", [])
            app_name = cat_action.get("app", "App")
            op_label = cat_action.get("label", s_name)
            op_key = cat_action.get("operation_id", "")
        else:
            # Fallback by operation string / keywords
            if any(w in s_text or w in op_id for w in ["refund", "delete", "remove", "purge", "terminate", "stripe.refund", "account.delete"]):
                side_effect = "irreversible"
                dmg = 10
                writes = ["stripe.refund"] if "refund" in s_text or "refund" in op_id else ["account.data"]
                app_name = "Stripe" if "refund" in s_text or "refund" in op_id else "Account Service"
                op_label = s_name or "Irreversible operation"
                op_key = "custom.irreversible"
            elif any(w in s_text or w in op_id for w in ["read", "lookup", "fetch", "check", "query", "sheets.read", "hubspot.lookup"]):
                side_effect = "read"
                dmg = 1
                writes = []
                app_name = "Database"
                op_label = s_name or "Read Record"
                op_key = "custom.read"
            else:
                side_effect = "write"
                dmg = 3
                writes = ["app.data"]
                app_name = "Service"
                op_label = s_name or "Action Step"
                op_key = "custom.write"

        if writes and side_effect != "read":
            writes_set.update(writes)
            write_apps.add(app_name)

        if dmg > max_damage:
            max_damage = dmg
            highest_impact_step_name = op_label
            damage_source = op_key or app_name

        action_infos.append({
            "name": s_name,
            "side_effect": side_effect,
            "damage": dmg,
            "writes": writes if side_effect != "read" else [],
            "app": app_name,
            "label": op_label,
            "op_key": op_key,
        })

    # Frequency mapping: {"weekly":1,"daily":2,"hourly":3,"constant":4}
    freq_label = str(wf.get("frequency") or "daily").lower()
    freq_map = {"weekly": 1, "daily": 2, "hourly": 3, "constant": 4}
    frequency = freq_map.get(freq_label, 2)
    freq_display = freq_label.capitalize()

    # --- RULE 1: any(catalog[a.operation].side_effect == "irreversible") ---
    has_irreversible = any(a["side_effect"] == "irreversible" for a in action_infos)
    if has_irreversible:
        irrev_action = next((a for a in action_infos if a["side_effect"] == "irreversible"), action_infos[0] if action_infos else {})
        action_phrase = irrev_action.get("label", "issue refunds or delete data").lower()
        headline = f"This workflow can {action_phrase} — that can't be undone, so we always verify it first."
        return _format_payload(
            decision="SIMULATE",
            tier="DEEP",
            scenario_count=40,
            estimated_seconds=3,
            reason_code="irreversible_action",
            headline=headline,
            highest_step=f"{highest_impact_step_name} (10/10)",
            runs=freq_display,
            writes_str=", ".join(sorted(list(write_apps))) if write_apps else "Stripe",
            unhandled="2 of 4 unhandled",
            damage=10,
            frequency=frequency,
        )

    # --- RULE 2: workflow.is_modification and parent workflow is active ---
    is_modification = bool(wf.get("is_modification", False))
    parent_status = wf.get("parent_status", "")
    if is_modification and parent_status == "active":
        headline = "You're editing a workflow that's already running. We'll check what changed."
        return _format_payload(
            decision="SIMULATE",
            tier="DEEP",
            scenario_count=40,
            estimated_seconds=3,
            reason_code="modification_of_live",
            headline=headline,
            highest_step=f"{highest_impact_step_name} ({max_damage}/10)",
            runs=freq_display,
            writes_str=", ".join(sorted(list(write_apps))) if write_apps else "Internal",
            unhandled="1 of 3 unhandled",
            damage=max_damage,
            frequency=frequency,
        )

    # --- RULE 3: get_conflicts(workflow_id) is non-empty ---
    if not wf.get("skip_db_conflicts"):
        stored_wfs = db.list_workflows(include_proposed=True)
        wf_id_str = str(wf.get("id"))
        candidate_eval_list = [
            w for w in stored_wfs
            if str(w.get("id")) != wf_id_str and w.get("status") == "active" and not w.get("is_proposed")
        ] + [{**wf, "status": "active", "is_proposed": False}]
        all_conflicts = conflict_detector.detect_all_conflicts(candidate_eval_list)
        matching_conflicts = [
            c for c in all_conflicts
            if any(str(iw.get("id")) == wf_id_str or str(iw.get("id")) == f"wf_{wf_id_str}"
                   for iw in c.get("involved_workflows", []))
        ]
        
        if matching_conflicts:
            n = len(matching_conflicts)
            headline = f"This workflow interacts with {n} other automation{'s' if n > 1 else ''}. Verify before activating."
            return _format_payload(
                decision="SIMULATE",
                tier="DEEP",
                scenario_count=40,
                estimated_seconds=3,
                reason_code="conflicts_detected",
                headline=headline,
                highest_step=f"{highest_impact_step_name} ({max_damage}/10)",
                runs=freq_display,
                writes_str=", ".join(sorted(list(write_apps))) if write_apps else "Shared fields",
                unhandled="Conflict check required",
                damage=max_damage,
                frequency=frequency,
            )

    # --- RULE 4: all(catalog[a.operation].side_effect == "read") ---
    # CRITICAL: Rule 4 requires EVERY action to be read-only. One write anywhere means SIMULATE.
    if len(action_infos) > 0 and all(a["side_effect"] == "read" for a in action_infos) and len(writes_set) == 0:
        headline = "This workflow only reads data. Nothing can be changed, so it's safe to run directly."
        return _format_payload(
            decision="DIRECT",
            tier=None,
            scenario_count=0,
            estimated_seconds=0,
            reason_code="read_only_no_writes",
            headline=headline,
            highest_step=f"{highest_impact_step_name} (1/10)",
            runs=freq_display,
            writes_str="None (Read-only)",
            unhandled="All handled",
            damage=1,
            frequency=frequency,
        )

    # --- RULE 5: Otherwise compute SVS = damage * frequency ---
    damage = max_damage
    svs = damage * frequency

    if svs > 20:
        tier = "DEEP"
        count = 40
        reason_code = "score_high"
        headline = f"High impact ({damage}/10) running {freq_label}. We'll test it thoroughly."
        est_sec = 3
    elif svs >= 5:
        tier = "STANDARD"
        count = 12
        reason_code = "score_high" if damage >= 4 else "score_low"
        headline = f"High impact ({damage}/10) running {freq_label}. We'll test it thoroughly." if damage >= 4 else f"Low impact and runs {freq_label}. A quick check is enough."
        est_sec = 2
    else:
        tier = "SHALLOW"
        count = 3
        reason_code = "score_low"
        headline = f"Low impact and runs {freq_label}. A quick check is enough."
        est_sec = 1

    return _format_payload(
        decision="SIMULATE",
        tier=tier,
        scenario_count=count,
        estimated_seconds=est_sec,
        reason_code=reason_code,
        headline=headline,
        highest_step=f"{highest_impact_step_name} ({damage}/10)",
        runs=freq_display,
        writes_str=", ".join(sorted(list(write_apps))) if write_apps else "Database",
        unhandled=f"{max(1, len(action_steps) // 2)} of {len(action_steps)} unhandled",
        damage=damage,
        frequency=frequency,
    )


def _format_payload(
    decision: str,
    tier: Optional[str],
    scenario_count: int,
    estimated_seconds: int,
    reason_code: str,
    headline: str,
    highest_step: str,
    runs: str,
    writes_str: str,
    unhandled: str,
    damage: int,
    frequency: int,
) -> Dict[str, Any]:
    """Format recommendation payload matching required JSON schema."""
    step_lvl = "high" if damage >= 8 else "medium" if damage >= 4 else "low"
    freq_lvl = "high" if frequency >= 3 else "medium" if frequency >= 2 else "low"
    writes_lvl = "high" if writes_str != "None (Read-only)" and writes_str != "None" else "low"
    err_lvl = "high" if decision == "SIMULATE" and (tier == "DEEP" or damage >= 8) else "medium"

    return {
        "decision": decision,
        "tier": tier,
        "scenario_count": scenario_count,
        "estimated_seconds": estimated_seconds,
        "reason_code": reason_code,
        "headline": headline,
        "factors": [
            {"label": "Highest-impact step", "value": highest_step, "level": step_lvl},
            {"label": "Runs", "value": runs, "level": freq_lvl},
            {"label": "Writes to", "value": writes_str, "level": writes_lvl},
            {"label": "Error handling", "value": unhandled, "level": err_lvl},
        ],
    }
