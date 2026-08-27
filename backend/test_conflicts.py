"""Test suite for FLOW Conflict Detection Engine (Step 5 Verification)."""

import json
import conflict_detector


def run_tests():
    print("==================================================")
    print("FLOW Conflict Detection - Step 5 Verification")
    print("==================================================")
    
    results = {}

    # Case 1: Trigger Loop (True Positive)
    # A: trigger form.submitted, writes hubspot.contact.owner_id
    # B: trigger hubspot.contact_updated (listens hubspot.contact.*), writes hubspot.contact.owner_id
    wf_1a = {
        "id": "wf_1a",
        "name": "Form Lead Creator",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    wf_1b = {
        "id": "wf_1b",
        "name": "Contact Update Sync",
        "status": "active",
        "steps": [
            {"name": "Contact Updated", "trigger_id": "hubspot.contact_updated", "listens": ["hubspot.contact.*"]},
            {"name": "Re-assign Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    res_1 = conflict_detector.detect_all_conflicts([wf_1a, wf_1b])
    c1_match = [c for c in res_1 if c["type"] == "trigger_loop" and c["severity"] == "high" and "hubspot.contact.owner_id" in c["evidence"]["field_paths"]]
    results["Case 1: Trigger Loop (A -> B -> A on hubspot.contact.owner_id)"] = {
        "expected": "trigger_loop (high, closing field hubspot.contact.owner_id)",
        "actual": f"Found {len(c1_match)} trigger loop(s): {c1_match[0]['message'] if c1_match else 'None'}",
        "passed": len(c1_match) > 0
    }

    # Case 2: Write Collision (True Positive)
    # A and B both trigger on form.submitted, both write hubspot.contact.owner_id
    wf_2a = {
        "id": "wf_2a",
        "name": "Form Handler A",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Owner A", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    wf_2b = {
        "id": "wf_2b",
        "name": "Form Handler B",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Owner B", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    res_2 = conflict_detector.detect_all_conflicts([wf_2a, wf_2b])
    c2_match = [c for c in res_2 if c["type"] == "write_collision" and c["severity"] == "medium" and "hubspot.contact.owner_id" in c["evidence"]["field_paths"]]
    results["Case 2: Write Collision (Both write hubspot.contact.owner_id on form.submitted)"] = {
        "expected": "write_collision (medium, field hubspot.contact.owner_id)",
        "actual": f"Found {len(c2_match)} write collision(s): {c2_match[0]['message'] if c2_match else 'None'}",
        "passed": len(c2_match) > 0
    }

    # Case 3: Unreachable Path (True Positive)
    # One workflow: condition employees > 100, then employees < 50
    wf_3 = {
        "id": "wf_3",
        "name": "Employee Router",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"id": "s1", "name": "Check Enterprise", "condition": "employees > 100"},
            {"id": "s2", "name": "Check Small Business", "condition": "employees < 50"},
        ]
    }
    res_3 = conflict_detector.detect_all_conflicts([wf_3])
    c3_match = [c for c in res_3 if c["type"] == "unreachable_path" and c["severity"] == "medium" and "employees" in c["evidence"]["field_paths"]]
    results["Case 3: Unreachable Path (employees > 100 then employees < 50)"] = {
        "expected": "unreachable_path (medium, field employees, steps s1 & s2)",
        "actual": f"Found {len(c3_match)} unreachable path(s): {c3_match[0]['message'] if c3_match else 'None'}",
        "passed": len(c3_match) > 0
    }

    # Case 4: False Positive — Different Fields
    # Both use HubSpot, but A writes owner_id and B writes lifecycle_stage
    wf_4a = {
        "id": "wf_4a",
        "name": "HubSpot Owner Assigner",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Set Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    wf_4b = {
        "id": "wf_4b",
        "name": "HubSpot Stage Updater",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Set Stage", "operation_id": "hubspot.update_stage", "writes": ["hubspot.contact.lifecycle_stage"]},
        ]
    }
    res_4 = conflict_detector.detect_all_conflicts([wf_4a, wf_4b])
    results["Case 4: False Positive (A writes owner_id, B writes lifecycle_stage)"] = {
        "expected": "0 conflicts (different fields)",
        "actual": f"{len(res_4)} conflict(s) found: {[c['message'] for c in res_4]}",
        "passed": len(res_4) == 0
    }

    # Case 5: False Positive — Read Only
    # Same trigger, but A only reads and B writes
    wf_5a = {
        "id": "wf_5a",
        "name": "Contact Lookup Reader",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Lookup Contact", "operation_id": "hubspot.lookup_contact", "side_effect": "read", "writes": []},
        ]
    }
    wf_5b = {
        "id": "wf_5b",
        "name": "Contact Owner Writer",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    res_5 = conflict_detector.detect_all_conflicts([wf_5a, wf_5b])
    results["Case 5: False Positive (A only reads, B writes)"] = {
        "expected": "0 conflicts (reads contribute nothing)",
        "actual": f"{len(res_5)} conflict(s) found: {[c['message'] for c in res_5]}",
        "passed": len(res_5) == 0
    }

    # Case 6: False Positive — Drafts Excluded
    # A writes hubspot.contact.owner_id, B is a DRAFT that listens for it
    wf_6a = {
        "id": "wf_6a",
        "name": "Active Lead Router",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    wf_6b = {
        "id": "wf_6b",
        "name": "Draft Onboarding",
        "status": "proposed",
        "is_proposed": True,
        "steps": [
            {"name": "Contact Updated", "trigger_id": "hubspot.contact_updated", "listens": ["hubspot.contact.*"]},
            {"name": "Assign Owner", "operation_id": "hubspot.assign_owner", "writes": ["hubspot.contact.owner_id"]},
        ]
    }
    res_6 = conflict_detector.detect_all_conflicts([wf_6a, wf_6b])
    results["Case 6: False Positive (B is a DRAFT)"] = {
        "expected": "0 conflicts (drafts excluded)",
        "actual": f"{len(res_6)} conflict(s) found: {[c['message'] for c in res_6]}",
        "passed": len(res_6) == 0
    }

    # Case 7: False Positive — Different Condition Fields
    # One workflow: condition country == "India", then condition employees < 50
    wf_7 = {
        "id": "wf_7",
        "name": "Regional Qualifier",
        "status": "active",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"id": "s1", "name": "Check Country", "condition": "country == 'India'"},
            {"id": "s2", "name": "Check Employees", "condition": "employees < 50"},
        ]
    }
    res_7 = conflict_detector.detect_all_conflicts([wf_7])
    results["Case 7: False Positive (country == 'India' then employees < 50)"] = {
        "expected": "0 conflicts (different fields, no contradiction)",
        "actual": f"{len(res_7)} conflict(s) found: {[c['message'] for c in res_7]}",
        "passed": len(res_7) == 0
    }

    all_passed = True
    for test_name, res in results.items():
        status_str = "[PASS]" if res["passed"] else "[FAIL]"
        if not res["passed"]:
            all_passed = False
        print(f"\n{status_str} - {test_name}")
        print(f"  Expected: {res['expected']}")
        print(f"  Actual:   {res['actual']}")

    print("\n" + "=" * 50)
    print(f"OVERALL RESULT: {'ALL 7 TESTS PASSED!' if all_passed else 'SOME TESTS FAILED'}")
    print("==================================================")
    return all_passed


if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)

