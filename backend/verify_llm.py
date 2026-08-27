"""Verify the two Gemini-backed endpoints (build steps 2 and 7).

Run this once after putting your key in backend/.env, with the backend running:
    python verify_llm.py
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
DEMO_SENTENCE = (
    "If order stays in packed status for more than 48 hours, "
    "alert warehouse and flag on dashboard"
)


def post(path, payload):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        print(f"\n  HTTP {exc.code} from {path}: {body}")
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"\n  Cannot reach {BASE} - is the backend running?  ({exc.reason})")
        sys.exit(1)


def main():
    print("=" * 68)
    print("STEP 2 - POST /api/parse")
    print("=" * 68)
    print(f'Input: "{DEMO_SENTENCE}"\n')

    wf = post("/api/parse", {"text": DEMO_SENTENCE, "source_system": "ERPNext"})["workflow"]
    print(json.dumps(wf, indent=2))

    print("\nReadable form:")
    print(f"  TRIGGER   : {wf['trigger']}  [{wf['trigger_type']}]")
    for c in wf["conditions"]:
        print(f"  CONDITION : {c['display']}   ({c['field']} {c['operator']} {c['value']})")
    for a in wf["actions"]:
        print(f"  ACTION    : {a['display']}")
    print(f"  PRIORITY  : {wf['priority']}")

    problems = []
    if wf["trigger_type"] != "order_status_change":
        problems.append(f"expected trigger_type order_status_change, got {wf['trigger_type']}")
    if len(wf["conditions"]) < 2:
        problems.append("expected 2 conditions (status + hours)")
    if len(wf["actions"]) < 2:
        problems.append("expected 2 actions (alert warehouse + flag dashboard)")
    if not any(c["field"] == "hours_since_update" for c in wf["conditions"]):
        problems.append("no hours_since_update condition")

    print("\n" + "=" * 68)
    print("STEP 3 cross-check - simulate the parsed rule")
    print("=" * 68)
    sim = post("/api/simulate", {"workflow": wf})
    print(f"  {sim['summary']}")
    print(f"  matched: {[r['record_id'] for r in sim['results'] if r['matched']]}")
    if sim["matched"] != 4:
        problems.append(f"expected 4 matches from the demo rule, got {sim['matched']}")

    print("\n" + "=" * 68)
    print("STEP 7 - POST /api/explain-conflict")
    print("=" * 68)
    scan = post("/api/conflicts", {})
    print(f"  {scan['summary']}")

    if not scan["conflicts"]:
        print("\n  No conflict present to explain. Deploy the Zoho rule first:")
        print('    "When an invoice is submitted for more than 30000, flag it for manual review"')
        print("  then re-run this script.")
    else:
        conflict = scan["conflicts"][0]
        print(f"  Conflict: {conflict['rule_a']['name']}  VS  {conflict['rule_b']['name']}")
        print(f"  Overlap : {conflict['overlap_label']}\n")
        explanation = post("/api/explain-conflict", {"conflict": conflict})["explanation"]
        print("  Gemini's explanation:")
        for para in explanation.split("\n\n"):
            print(f"    {para.strip()}\n")
        if len(explanation) < 60:
            problems.append("explanation looks too short")

    stats = json.loads(urllib.request.urlopen(f"{BASE}/api/stats", timeout=15).read())
    print("=" * 68)
    print(f"LLM calls used: {stats['llm_calls']}   |   "
          f"rules evaluated with 0 LLM calls: {stats['rules_evaluated']}   |   "
          f"conflict pairs with 0 LLM calls: {stats['pairs_compared']}")
    print("=" * 68)

    if problems:
        print("\nCHECK THESE:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("\nAll LLM endpoints verified.")


if __name__ == "__main__":
    main()
