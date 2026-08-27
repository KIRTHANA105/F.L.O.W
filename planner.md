# FLOW — Build Planner

**Goal:** a demo-able Business Process Memory copilot. The differentiator is that FLOW
*knows what you already built* — reuse, policy, conflict — not that it generates workflows.

**Constraint set for this plan (from your brief):**

- LLM is for parsing, checking, analysing, phrasing. Fine to use.
- Storage/infra work is **not** a priority. SQLite as-is. No auth hardening, no multi-tenant.
- Everything must be demo-visible on screen.

---

## 0. Reality check — verified today, not assumed

I ran the current code before planning. Three findings change what we should build.

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **`gemini-2.5-flash` is retired** | `404: no longer available to new users` | Every LLM feature was dead. **Fixed** → `gemini-3.5-flash`. |
| 2 | **Free tier = 20 requests/day/model** | `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: 20` | **This is the #1 demo risk.** See §1. |
| 3 | **`/api/resolve-conflict` returned invalid JSON** | Truncated mid-string at `max_output_tokens=800` | **Fixed** → added `RESOLVE_SCHEMA` + 2000 tokens. Verified 3× consecutive valid. |

**Also measured:**

- Cold-start parse: **57s**. Warm: **~9s**. Explain: ~5s. (A 57s hang on stage looks broken — §1.)
- Quota is **per model**: `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`
  each have their own 20/day. This is the fallback lever.
- Port 8000 is held by a zombie socket (PID 5052, process gone, survives `taskkill`).
  Use another port or reboot. I verified everything on **8010**.

**Already working (more than the README claims):**

`/api/health-score` · `/api/resolve-conflict` · `/api/apply-fix` · deploy-time conflict
detection (`conflicts_detected`) · Suggest Fix / Apply Fix UI · auth screen.

I verified the **full self-healing loop end to end**: detect → suggest → apply → re-verify
→ `found 0 conflicts`, health score **65 → 80**. Spec §4.4 substantially works today.

---

## 1. The decision that shapes everything: 20 LLM calls/day

A 5-minute demo with parse + explain + resolve is ~6–10 calls. Two rehearsals plus the
real run **exceeds the daily cap**, and the cap resets on Google's clock, not yours.

This is not a reason to use less LLM — it is a reason to make LLM calls *not* be on the
critical path of the demo. Three mechanisms, in priority order:

**A. Response cache (build first, ~30 min).**
Hash `(endpoint, prompt)` → store the response in SQLite. A repeated demo sentence costs
**0 calls**. Rehearse all day on one budget, and the on-stage path is a cache hit —
which also erases the 57s cold start. This is the single highest-value item in the plan.

**B. Model fallback chain.**
On 429, transparently retry the next model (`gemini-3.5-flash` → `gemini-3.1-flash-lite`
→ `gemini-flash-latest`). Turns one 20-call budget into ~60.

**C. Demo Safety Mode toggle.**
A dashboard switch that serves canned-but-real responses (captured from actual runs) for
every LLM endpoint. If the venue wifi dies or quota is gone, the demo still runs. Judges
see the same screens. **Non-negotiable for a live demo.**

> Prewarm before walking on stage: one throwaway call so nothing you show is a cold start.

---

## 2. Demo business situation

The spec's HR-onboarding example is fine but abstract. This scenario makes *memory* the
visible hero, and it reuses the invoice/order data already seeded.

**Company:** *Sundar Textiles* — a mid-size manufacturer, 6 departments, 3 systems
(ERPNext, Zoho, Internal). They've been automating for 18 months. Nobody remembers
everything that was built. **That is the problem FLOW solves.**

Pre-seeded memory (the "18 months of history" that makes the demo land):

| Dept | Workflow | Capability |
|---|---|---|
| Finance | Auto-approve small invoices (< 50,000 → approve) | `finance.approve_invoice` |
| Finance | Vendor payment release | `finance.release_payment` |
| Sales | Lead intake → CRM record | `crm.create_record` |
| Sales | Deal alerts → notify sales | `notify.sales_team` |
| Ops | Stale packed order escalation | `notify.warehouse` |
| IT | Access provisioning | `access.grant_seat` |

Policy set (plain English, compiled at signup):

1. *"Purchases over ₹80,000 need CFO approval."*
2. *"Contractors don't get GitHub Pro."*
3. *"Anything flagged for review can't be auto-approved."* ← the policy that fires in Beat 4

### The 5-minute run

| Beat | Screen | Line | Proof |
|---|---|---|---|
| **1** | Dashboard | "18 months of automation. 6 workflows, 3 policies, health 92." | Memory exists before we touch anything |
| **2** | Create | *"When a high-value customer signs up, create a CRM record, notify sales, and assign a senior rep."* | **Memory Match**: 2 of 3 capabilities already exist. "Building 1 new action. Reusing 2." ← **the differentiator** |
| **3** | Create | Policy Check + Simulate | Green pass, 4/15 matched — pure Python, 0 LLM |
| **4** | Create → Conflicts | Deploy *"flag invoices over 30,000 for manual review"* | Deploy banner fires immediately, then red conflict card: overlap 30k–50k, **3 real invoices affected** |
| **5** | Conflicts | **Suggest Fix → Apply** | Boundary moves to 30,000, re-scan → **0 conflicts**, health **65 → 80**. Self-healing, on screen. |
| **6** | Dashboard | Stats bar | "3 LLM calls. 45 rules evaluated, 6 pairs compared — 0 LLM." Cost story. |

**Why Beat 2 wins:** every competitor generates the workflow. Only FLOW says *"you already
built 2 of these in January."* Land that sentence out loud.

---

## 3. Build order

Ordered by demo value per hour. **Ship P0 before touching anything below it.**

### P0 — Demo cannot run without these

| # | Task | Why | Est |
|---|---|---|---|
| 0.1 | ✅ Fix retired model | `gemini-3.5-flash` | done |
| 0.2 | ✅ Fix resolver JSON | schema + 2000 tokens | done |
| 0.3 | ✅ **LLM response cache** | 10.2s → **0.006s**, 0 quota | done |
| 0.4 | ✅ **Demo Safety Mode** | full demo verified offline | done |
| 0.5 | ✅ **Model fallback on 429** | 3-model chain in `llm.py` | done |
| 0.6 | ✅ Move off port 8000 | now **8010**, `VITE_API_BASE` override | done |

### P1 — The differentiator (this *is* the product)

| # | Task | Why | Est |
|---|---|---|---|
| 1.1 | ✅ `capabilities` + `wf_capabilities` tables | in `db.py` | done |
| 1.2 | ✅ Capability registry (20 `domain.operation`) | `capabilities.py` | done |
| 1.3 | ✅ Intent parser → required capabilities | enum-constrained in `PARSE_SCHEMA` | done |
| 1.4 | ✅ **Delta computation** | `engine.compute_delta` — pure Python | done |
| 1.5 | ✅ **Memory Match card** | verified in browser | done |
| 1.6 | ✅ Sundar Textiles seed (6 workflows, 4 depts) | + customers/employees mock data | done |

### P2 — Policy layer

| # | Task | Est |
|---|---|---|
| 2.1 | `policies` table + compile plain English → JSON (1 LLM call) | 45m |
| 2.2 | Policy check — **pure Python**, IR vs compiled rules | 45m |
| 2.3 | Policy Check card (pass / violations + affected count) | 30m |

### P3 — Visible memory

| # | Task | Est |
|---|---|---|
| 3.1 | BPM Explorer, department tree, shared-capability indicator | 1.5h |
| 3.2 | Resolution history table (reuse Active Workflows styling) | 30m |

### P4 — Only if time remains

React Flow graph · signup wizard · n8n export · simulation upgrades · dependency edges.

> **Cut line:** P0 + P1 is a demo that wins on the memory story alone. P2 makes it
> credible as a product. Everything below P3 is polish. Do not start P4 before P2 ships.

---

## 4. Architecture rule (keep this honest)

The LLM appears in **exactly four places**:

1. Parse intent → capabilities 2. Generate delta IR 3. Compile policies 4. Phrase findings/fixes

It **never** decides whether something passes. Conflict detection, policy checks, delta
computation, and re-verification are deterministic Python over the IR and the graph.

That boundary is a *feature* — say it on stage. It's why the stats bar reads
"45 rules evaluated, 0 LLM calls," and it's why the system is cheap and auditable.
Guard it: the moment a check moves into a prompt, the product becomes unverifiable.

---

## 5. Deviations from the spec — and why

| Spec says | Plan does | Why |
|---|---|---|
| NetworkX graph | Plain SQL joins for now | 6 workflows don't need traversal. Add NetworkX when cycle detection is real work. |
| Pydantic IR + full node types | Extend current flat schema | Current shape already drives sim + conflicts. A rewrite risks working code for no demo gain. |
| Signup wizard first (build order #3) | Seed the company instead | A wizard costs an hour and shows nothing judges care about. Seeded memory tells the story better. |
| Simulation last (#10) | Already working, keep it | Don't touch it. |
| `runs` / `events` / `resolutions` tables | Skip `runs`/`events`; add `resolutions` only if P3.2 ships | You said storage isn't the priority. |

**One thing I'd push back on:** spec §8 puts signup at step 3 and conflicts at step 8.
For a *demo*, that's backwards — conflicts and memory-match are what judges remember,
and signup is a form. This plan front-loads the differentiator and seeds the rest.

---

## 6. Status — P0 and P1 shipped

All six beats verified end to end in a real browser, twice: **live** and with
**Safety Mode ON** (zero network calls). No console errors in either run.

```
BEAT1 dashboard: 6 workflows across 4 departments
BEAT2 Building 1 new action. Reusing 2 existing workflows.
BEAT3 This rule would have fired on 8 out of 12 customers
BEAT4 1 conflict — overlap 30,000–50,000, 3 live invoices affected
BEAT5 Suggest Fix → Apply → 0 conflicts, health 65 → 80
BEAT6 3 LLM calls | 12 rules + 42 pairs evaluated with 0 LLM
```

### Bugs found and fixed while building

| Bug | Why it mattered |
|---|---|
| `gemini-2.5-flash` retired (404) | Every LLM feature was dead |
| Resolver truncated at 800 tokens | Suggest Fix always failed |
| **Bad responses were cached** | One truncated reply poisoned the demo permanently |
| **Cache key included DB ids** | Safety Mode missed after every reseed |
| **Apply-fix patched the wrong rule** | Silently inverted the auto-approve rule |
| Parse mapped "high-value" → name field | Beat 3 matched 0 records |
| Resolver JSON shown raw in UI | Violated spec §9 "user never sees JSON" |
| Explanations cited "Rules 29 and 34" | Leaked DB ids to a business user |

### Next: P2 (policy layer)

1. `2.1` `policies` table + compile plain English → JSON (1 LLM call)
2. `2.2` Policy check — pure Python, IR vs compiled rules
3. `2.3` Policy Check card

**Before demo day:** run once live to warm the cache, then flip Safety Mode ON and
leave it on. Backend on **8010** (`npm run dev` frontend reads `VITE_API_BASE`).
