"""Verification test suite for SVS Simulation vs Direct Decision Gate."""

import recommendation


def run_tests():
    print("==================================================")
    print("FLOW Decision Gate - SVS 5 Verification Cases")
    print("==================================================")

    results = {}

    # Case 1: form -> sheets.append_row, weekly
    # damage 1 x freq 1 = 1 -> SIMULATE / SHALLOW / 3
    wf_1 = {
        "id": "test_1",
        "name": "Form to Sheets",
        "frequency": "weekly",
        "skip_db_conflicts": True,
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Append Row", "operation_id": "sheets.append_row"},
        ]
    }
    r1 = recommendation.compute_recommendation(wf_1)
    pass_1 = r1["decision"] == "SIMULATE" and r1["tier"] == "SHALLOW" and r1["scenario_count"] == 3
    results["Case 1: form -> sheets.append_row, weekly"] = {
        "expected": "SIMULATE / SHALLOW / 3 scenarios",
        "actual": f"{r1['decision']} / {r1['tier']} / {r1['scenario_count']} scenarios (reason: {r1['reason_code']})",
        "passed": pass_1
    }

    # Case 2: form -> hubspot.assign + gmail.send, hourly
    # damage 4 x freq 3 = 12 -> SIMULATE / STANDARD / 12
    wf_2 = {
        "id": "test_2",
        "name": "Lead Intake & Notify",
        "frequency": "hourly",
        "skip_db_conflicts": True,
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Assign Contact", "operation_id": "hubspot.assign_owner"},
            {"name": "Send Email", "operation_id": "gmail.send"},
        ]
    }
    r2 = recommendation.compute_recommendation(wf_2)
    pass_2 = r2["decision"] == "SIMULATE" and r2["tier"] == "STANDARD" and r2["scenario_count"] == 12
    results["Case 2: form -> hubspot.assign + gmail.send, hourly"] = {
        "expected": "SIMULATE / STANDARD / 12 scenarios",
        "actual": f"{r2['decision']} / {r2['tier']} / {r2['scenario_count']} scenarios (reason: {r2['reason_code']})",
        "passed": pass_2
    }

    # Case 3: form -> stripe.refund, weekly
    # stripe.refund is irreversible -> SIMULATE / DEEP / 40 / irreversible_action
    wf_3 = {
        "id": "test_3",
        "name": "Refund Form",
        "frequency": "weekly",
        "steps": [
            {"name": "Form Submitted", "trigger_id": "form.submitted"},
            {"name": "Issue Refund", "operation_id": "stripe.refund"},
        ]
    }
    r3 = recommendation.compute_recommendation(wf_3)
    pass_3 = r3["decision"] == "SIMULATE" and r3["tier"] == "DEEP" and r3["reason_code"] == "irreversible_action"
    results["Case 3: form -> stripe.refund, weekly"] = {
        "expected": "SIMULATE / DEEP / irreversible_action",
        "actual": f"{r3['decision']} / {r3['tier']} / reason: {r3['reason_code']}",
        "passed": pass_3
    }

    # Case 4: schedule -> sheets.read -> slack.post
    # slack.post is a WRITE -> must be SIMULATE
    wf_4 = {
        "id": "test_4",
        "name": "Scheduled Sheet Read & Alert",
        "frequency": "daily",
        "steps": [
            {"name": "Cron Schedule", "trigger_id": "schedule.cron"},
            {"name": "Read Rows", "operation_id": "sheets.read"},
            {"name": "Post to Slack", "operation_id": "slack.post"},
        ]
    }
    r4 = recommendation.compute_recommendation(wf_4)
    pass_4 = r4["decision"] == "SIMULATE"
    results["Case 4: schedule -> sheets.read -> slack.post (slack.post is WRITE)"] = {
        "expected": "SIMULATE (NOT DIRECT)",
        "actual": f"{r4['decision']} / {r4['tier']} / {r4['scenario_count']} scenarios",
        "passed": pass_4
    }

    # Case 5: schedule -> sheets.read only, no writes at all
    # pure read-only -> DIRECT / read_only_no_writes
    wf_5 = {
        "id": "test_5",
        "name": "Scheduled Sheet Sync Read Only",
        "frequency": "hourly",
        "steps": [
            {"name": "Cron Schedule", "trigger_id": "schedule.cron"},
            {"name": "Read Rows", "operation_id": "sheets.read"},
        ]
    }
    r5 = recommendation.compute_recommendation(wf_5)
    pass_5 = r5["decision"] == "DIRECT" and r5["reason_code"] == "read_only_no_writes"
    results["Case 5: schedule -> sheets.read only (no writes)"] = {
        "expected": "DIRECT / read_only_no_writes",
        "actual": f"{r5['decision']} / tier: {r5['tier']} / reason: {r5['reason_code']}",
        "passed": pass_5
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
    print(f"OVERALL RESULT: {'ALL 5 SVS GATE TESTS PASSED!' if all_passed else 'SOME TESTS FAILED'}")
    print("==================================================")
    return all_passed


if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)
