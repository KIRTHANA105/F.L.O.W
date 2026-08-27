"""Complete verification suite for Conflict Detection on Real Stored Workflows (Step 6)."""

import json
import urllib.request
import conflict_detector
import recommendation


def run_all_checks():
    print("==================================================")
    print("FLOW Conflict Detection - Real Pipeline Verification")
    print("==================================================")

    results = {}

    # Seed samples via endpoint
    req = urllib.request.Request("http://127.0.0.1:8010/api/workflows/seed-samples", method="POST")
    with urllib.request.urlopen(req) as resp:
        seed_data = json.loads(resp.read().decode())
    
    seeded_wfs = seed_data.get("seeded", [])
    wf_a = next(w for w in seeded_wfs if "Router" in w["name"])
    wf_b = next(w for w in seeded_wfs if "Assigner" in w["name"])
    wf_c = next(w for w in seeded_wfs if "Logger" in w["name"])

    # 1. Seeded A + B -> trigger_loop, HIGH, field hubspot.contact.owner_id
    conflicts_ab = conflict_detector.detect_all_conflicts([wf_a, wf_b])
    c1 = [c for c in conflicts_ab if c["type"] == "trigger_loop" and c["severity"] == "high" and "hubspot.contact.owner_id" in c["evidence"]["field_paths"]]
    results["Check 1: Seeded A + B trigger loop on hubspot.contact.owner_id"] = {
        "expected": "trigger_loop, HIGH, field hubspot.contact.owner_id",
        "actual": f"Found {len(c1)} loop(s): {c1[0]['message'] if c1 else 'None'}",
        "passed": len(c1) > 0
    }

    # 2. Two workflows, same trigger, both write contact.owner_id -> write_collision
    wf_coll_1 = {
        "id": "wf_c1", "name": "Form Assigner 1", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Assign", "operation_id": "hubspot.assign_owner"}]
    }
    wf_coll_2 = {
        "id": "wf_c2", "name": "Form Assigner 2", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Assign", "operation_id": "hubspot.update_contact"}]
    }
    conflicts_coll = conflict_detector.detect_all_conflicts([wf_coll_1, wf_coll_2])
    c2 = [c for c in conflicts_coll if c["type"] == "write_collision" and "hubspot.contact.owner_id" in c["evidence"]["field_paths"]]
    results["Check 2: Same trigger + both write contact.owner_id -> write_collision"] = {
        "expected": "write_collision, MEDIUM",
        "actual": f"Found {len(c2)} write collision(s): {c2[0]['message'] if c2 else 'None'}",
        "passed": len(c2) > 0
    }

    # 3. One workflow: employees > 100 then employees < 50 -> unreachable_path
    wf_unreach = {
        "id": "wf_u", "name": "Unreachable Filter", "status": "active",
        "steps": [
            {"name": "Form", "trigger_id": "form.submitted"},
            {"id": "s1", "name": "Large Company", "condition": "employees > 100"},
            {"id": "s2", "name": "Small Company", "condition": "employees < 50"},
        ]
    }
    conflicts_unreach = conflict_detector.detect_all_conflicts([wf_unreach])
    c3 = [c for c in conflicts_unreach if c["type"] == "unreachable_path"]
    results["Check 3: employees > 100 then employees < 50 -> unreachable_path"] = {
        "expected": "unreachable_path, MEDIUM",
        "actual": f"Found {len(c3)} unreachable path(s): {c3[0]['message'] if c3 else 'None'}",
        "passed": len(c3) > 0
    }

    # 4. Both use HubSpot but write different fields -> no conflict
    wf_diff_1 = {
        "id": "wf_d1", "name": "Owner Assigner", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Assign", "operation_id": "hubspot.assign_owner"}]
    }
    wf_diff_2 = {
        "id": "wf_d2", "name": "Stage Updater", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Stage", "operation_id": "hubspot.update_stage"}]
    }
    c4 = conflict_detector.detect_all_conflicts([wf_diff_1, wf_diff_2])
    results["Check 4: Both use HubSpot but write different fields (owner_id vs lifecycle_stage)"] = {
        "expected": "0 conflicts",
        "actual": f"{len(c4)} conflict(s) found",
        "passed": len(c4) == 0
    }

    # 5. Same trigger, one reads only -> no conflict
    wf_read = {
        "id": "wf_r", "name": "Contact Reader", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Lookup", "operation_id": "hubspot.lookup_contact"}]
    }
    wf_write = {
        "id": "wf_w", "name": "Contact Writer", "status": "active",
        "steps": [{"name": "Form", "trigger_id": "form.submitted"}, {"name": "Assign", "operation_id": "hubspot.assign_owner"}]
    }
    c5 = conflict_detector.detect_all_conflicts([wf_read, wf_write])
    results["Check 5: Same trigger, one reads only -> no conflict"] = {
        "expected": "0 conflicts",
        "actual": f"{len(c5)} conflict(s) found",
        "passed": len(c5) == 0
    }

    # 6. One of the pair is a draft -> no conflict
    wf_draft = {
        "id": "wf_draft", "name": "Draft Assigner", "status": "proposed", "is_proposed": True,
        "steps": [{"name": "Contact Updated", "trigger_id": "hubspot.contact_updated"}, {"name": "Update", "operation_id": "hubspot.update_contact"}]
    }
    c6 = conflict_detector.detect_all_conflicts([wf_a, wf_draft])
    results["Check 6: One workflow in pair is a draft -> no conflict"] = {
        "expected": "0 conflicts (drafts excluded)",
        "actual": f"{len(c6)} conflict(s) found",
        "passed": len(c6) == 0
    }

    # 7. Conditions on different fields (country == 'India', employees < 50) -> no conflict
    wf_diff_cond = {
        "id": "wf_dc", "name": "Multi Field Qualifier", "status": "active",
        "steps": [
            {"name": "Form", "trigger_id": "form.submitted"},
            {"id": "s1", "name": "India Only", "condition": "country == 'India'"},
            {"id": "s2", "name": "Small Team", "condition": "employees < 50"},
        ]
    }
    c7 = conflict_detector.detect_all_conflicts([wf_diff_cond])
    results["Check 7: Conditions on different fields -> no conflict"] = {
        "expected": "0 conflicts",
        "actual": f"{len(c7)} conflict(s) found",
        "passed": len(c7) == 0
    }

    # 8. Seeded workflow C appears with zero conflicts
    with urllib.request.urlopen(f"http://127.0.0.1:8010/api/conflicts/{wf_c['id']}") as resp:
        c_conflicts = json.loads(resp.read().decode())
    results["Check 8: Seeded workflow C (Sheet Logger) has zero conflicts"] = {
        "expected": "0 conflicts for workflow C",
        "actual": f"{c_conflicts.get('count', 0)} conflict(s) for workflow C",
        "passed": c_conflicts.get("count", 0) == 0
    }

    # 9. Recommendation gate detects conflict on newly created workflow
    rec_b = recommendation.compute_recommendation(wf_b)
    results["Check 9: Conflicting workflow triggers DEEP on recommendation gate"] = {
        "expected": "DEEP / conflicts_detected",
        "actual": f"tier: {rec_b.get('tier')} / reason: {rec_b.get('reason_code')}",
        "passed": rec_b.get("tier") == "DEEP" and rec_b.get("reason_code") == "conflicts_detected"
    }

    # 10. Confirm no hardcoded demo conflict chips in frontend
    with open("../frontend/src/components/CreateWorkflowModal.jsx", "r", encoding="utf-8") as f:
        modal_code = f.read()
    no_hardcoded = "CONFLICT_EXAMPLE" not in modal_code and "Demo: conflict scenario" not in modal_code
    results["Check 10: No hardcoded demo conflict chips remain in frontend"] = {
        "expected": "No CONFLICT_EXAMPLE chips in CreateWorkflowModal.jsx",
        "actual": "Clean: no hardcoded demo chips" if no_hardcoded else "Found hardcoded chips",
        "passed": no_hardcoded
    }

    all_passed = True
    for check_name, res in results.items():
        status_str = "[PASS]" if res["passed"] else "[FAIL]"
        if not res["passed"]:
            all_passed = False
        print(f"\n{status_str} - {check_name}")
        print(f"  Expected: {res['expected']}")
        print(f"  Actual:   {res['actual']}")

    print("\n" + "=" * 50)
    print(f"OVERALL VERIFICATION: {'ALL 10 CHECKS PASSED!' if all_passed else 'SOME CHECKS FAILED'}")
    print("==================================================")
    return all_passed


if __name__ == "__main__":
    success = run_all_checks()
    exit(0 if success else 1)
