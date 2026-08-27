# FLOW — AI-Powered Business Automation Copilot

Describe an automation rule in plain English, prove it against real history before
trusting it, deploy it, and catch the rules that silently contradict each other.

## Run it (two terminals)

**1. Backend**

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # then paste your key into backend/.env
python -m uvicorn main:app --port 8000
```

`backend/.env` needs one line:

```
ANTHROPIC_API_KEY=sk-ant-...
```

**2. Frontend**

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The SQLite DB (`backend/flow.db`) is created and seeded with 3 starter workflows on
first startup. Everything except `/api/parse` and `/api/explain-conflict` works
without an API key.

## Verify the Claude endpoints

With the backend running:

```bash
cd backend
python verify_llm.py
```

Prints the parsed JSON for the demo sentence, cross-checks the simulation, and
generates a real conflict explanation.

## Demo script

| Beat | Screen | What to do |
|---|---|---|
| 1 | Create Workflow | Type the rule (or click the **Demo rule** chip) → **Parse** → trigger/conditions/actions render as cards |
| 2 | same screen | **Simulate** → table of 15 orders, 4 green MATCHED rows, "fired on 4 out of 15 orders" |
| 3 | same screen | **Confirm & Deploy** → jumps to Dashboard, new rule is live alongside the 3 seeded ones |
| 4 | Create → Conflicts | Create the Zoho rule *"When an invoice is submitted for more than 30000, flag it for manual review"*, deploy it, then **Scan for Conflicts** → red conflict card → **Explain this conflict** |
| 5 | Dashboard | Stats bar: LLM calls vs. the rules and rule-pairs processed with zero LLM calls |

**Beat 4 setup is already seeded.** The ERPNext rule *"Auto-approve small invoices"*
(amount < 50,000 → auto-approve) ships in the DB. The Zoho rule you create live
(amount > 30,000 → flag) contradicts it between 30,000 and 50,000.

`POST /api/reset` re-seeds the DB and zeroes the counters for a clean second run.

## How conflict detection works

Pure Python, no LLM. Two active rules conflict when all three hold:

1. **Same trigger type** — both fire on the same business event.
2. **Overlapping condition range** — their numeric conditions are collapsed into
   intervals; a conflict needs a non-empty intersection.
3. **Contradictory actions** — one rule's actions are permissive
   (approve/allow/release…) and the other's are restrictive (flag/block/hold/reject…).

Claude is called only when you press **Explain this conflict**. That split is the
cost story: detection scales as pure computation, and the LLM is spent on the
one thing it is uniquely good at — explaining the problem to a human.

## API

| Method | Endpoint | LLM? | Purpose |
|---|---|---|---|
| POST | `/api/parse` | ✅ 1 call | Plain English → structured workflow JSON |
| POST | `/api/simulate` | — | Run conditions against mock history |
| GET/POST | `/api/workflows` | — | List / deploy workflows |
| DELETE | `/api/workflows/{id}` | — | Remove a workflow |
| POST | `/api/conflicts` | — | Pairwise conflict scan |
| POST | `/api/explain-conflict` | ✅ 1 call | Plain-English explanation + resolution |
| GET | `/api/stats` | — | Session counters |
| POST | `/api/reset` | — | Re-seed demo state |

Model: `claude-sonnet-4-6`. `/api/parse` uses a JSON schema via `output_config`, so
the response shape is guaranteed rather than parsed hopefully.

## Layout

```
backend/
  main.py          FastAPI app, endpoints, Claude calls
  engine.py        simulation + conflict detection (pure Python)
  db.py            SQLite schema, CRUD, seed data
  verify_llm.py    checks the two Claude endpoints
  mock_data/       orders.json (15), invoices.json (8)
frontend/src/
  App.jsx          tabs + shared state
  api.js           fetch wrapper
  components/      Dashboard, CreateWorkflow, Conflicts, Shared
```
