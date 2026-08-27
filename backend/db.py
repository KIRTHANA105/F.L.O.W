"""SQLite persistence for FLOW - Nexora Technologies process memory.

Data model:
  workflows              - existing operational processes, each a step sequence
                            with optional business_rules (conditional logic)
  workflow_dependencies   - directed edges between workflows (the process graph)
  policy_documents        - uploaded .txt/.pdf files
  policy_rules            - sentences extracted from documents, compiled for
                            matching against a proposed workflow's steps
"""
import json
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "flow.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    department     TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    steps          TEXT    NOT NULL,   -- JSON array of {name, description}
    business_rules TEXT    NOT NULL DEFAULT '[]',  -- JSON array of {condition, path}
    status         TEXT    NOT NULL DEFAULT 'active',
    is_proposed    INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_dependencies (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    from_workflow_id  INTEGER NOT NULL,
    to_workflow_id    INTEGER NOT NULL,
    relationship      TEXT NOT NULL DEFAULT 'precedes',  -- precedes | triggers | requires
    label             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS policy_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT NOT NULL,
    raw_text    TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   INTEGER,
    title         TEXT NOT NULL,
    text          TEXT NOT NULL,
    department    TEXT NOT NULL DEFAULT 'Company-wide',
    compiled_json TEXT NOT NULL DEFAULT '{}',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);
"""


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(force_reseed=False):
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM workflows").fetchone()["c"]
    conn.close()

    if force_reseed and count:
        conn = connect()
        for table in (
            "workflow_dependencies", "workflows",
            "policy_rules", "policy_documents",
        ):
            conn.execute(f"DELETE FROM {table}")
        conn.commit()
        conn.close()
        count = 0

    if count == 0:
        _seed()
        return len(SEED_WORKFLOWS)
    return 0


# --- Workflows ---------------------------------------------------------------
def _row_to_workflow(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "department": row["department"],
        "description": row["description"],
        "steps": json.loads(row["steps"]),
        "business_rules": json.loads(row["business_rules"]),
        "status": row["status"],
        "is_proposed": bool(row["is_proposed"]),
        "created_at": row["created_at"],
    }


def insert_workflow(wf, status="active", is_proposed=False):
    conn = connect()
    cur = conn.execute(
        """INSERT INTO workflows
           (name, department, description, steps, business_rules, status,
            is_proposed, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            wf.get("name") or "Untitled workflow",
            wf.get("department") or "Operations",
            wf.get("description") or "",
            json.dumps(wf.get("steps") or []),
            json.dumps(wf.get("business_rules") or []),
            status,
            1 if is_proposed else 0,
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    for dep in wf.get("dependencies") or []:
        add_dependency(dep["from_workflow_id"], new_id, dep.get("relationship", "precedes"),
                        dep.get("label", ""))

    return get_workflow(new_id)


def get_workflow(workflow_id):
    conn = connect()
    row = conn.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
    conn.close()
    return _row_to_workflow(row) if row else None


def list_workflows(include_proposed=False):
    conn = connect()
    sql = "SELECT * FROM workflows"
    if not include_proposed:
        sql += " WHERE is_proposed = 0"
    rows = conn.execute(sql + " ORDER BY id ASC").fetchall()
    conn.close()
    workflows = [_row_to_workflow(r) for r in rows]
    dep_map = dependency_map()
    for wf in workflows:
        wf["depends_on"] = dep_map["incoming"].get(wf["id"], [])
        wf["leads_to"] = dep_map["outgoing"].get(wf["id"], [])
    return workflows


def delete_workflow(workflow_id):
    conn = connect()
    cur = conn.execute("DELETE FROM workflows WHERE id=?", (workflow_id,))
    conn.execute(
        "DELETE FROM workflow_dependencies WHERE from_workflow_id=? OR to_workflow_id=?",
        (workflow_id, workflow_id),
    )
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0


# --- Dependencies (the process graph edges) ----------------------------------
def add_dependency(from_id, to_id, relationship="precedes", label=""):
    conn = connect()
    conn.execute(
        """INSERT INTO workflow_dependencies
           (from_workflow_id, to_workflow_id, relationship, label)
           VALUES (?,?,?,?)""",
        (from_id, to_id, relationship, label),
    )
    conn.commit()
    conn.close()


def list_dependencies():
    conn = connect()
    rows = conn.execute("SELECT * FROM workflow_dependencies").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def dependency_map():
    """workflow_id -> [{workflow_id, name, relationship, label}] both directions."""
    conn = connect()
    rows = conn.execute(
        """SELECT d.*, wf.name AS from_name, wt.name AS to_name
           FROM workflow_dependencies d
           JOIN workflows wf ON wf.id = d.from_workflow_id
           JOIN workflows wt ON wt.id = d.to_workflow_id"""
    ).fetchall()
    conn.close()
    outgoing, incoming = {}, {}
    for r in rows:
        outgoing.setdefault(r["from_workflow_id"], []).append({
            "workflow_id": r["to_workflow_id"], "name": r["to_name"],
            "relationship": r["relationship"], "label": r["label"],
        })
        incoming.setdefault(r["to_workflow_id"], []).append({
            "workflow_id": r["from_workflow_id"], "name": r["from_name"],
            "relationship": r["relationship"], "label": r["label"],
        })
    return {"outgoing": outgoing, "incoming": incoming}


# --- Policy documents ---------------------------------------------------------
def insert_policy_document(filename, raw_text):
    conn = connect()
    cur = conn.execute(
        "INSERT INTO policy_documents (filename, raw_text, uploaded_at) VALUES (?,?,?)",
        (filename, raw_text, datetime.now(timezone.utc).isoformat(timespec="seconds")),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def list_policy_documents():
    conn = connect()
    rows = conn.execute("SELECT * FROM policy_documents ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Policy rules (extracted, compiled) ---------------------------------------
def _row_to_policy_rule(row):
    return {
        "id": row["id"],
        "document_id": row["document_id"],
        "title": row["title"],
        "text": row["text"],
        "department": row["department"],
        "compiled": json.loads(row["compiled_json"]),
        "active": bool(row["active"]),
        "created_at": row["created_at"],
    }


def insert_policy_rule(document_id, title, text, department, compiled, active=True):
    conn = connect()
    cur = conn.execute(
        """INSERT INTO policy_rules
           (document_id, title, text, department, compiled_json, active, created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (
            document_id, title, text, department or "Company-wide",
            json.dumps(compiled or {}), 1 if active else 0,
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return get_policy_rule(new_id)


def get_policy_rule(rule_id):
    conn = connect()
    row = conn.execute("SELECT * FROM policy_rules WHERE id=?", (rule_id,)).fetchone()
    conn.close()
    return _row_to_policy_rule(row) if row else None


def list_policy_rules(active_only=False):
    conn = connect()
    sql = "SELECT * FROM policy_rules"
    if active_only:
        sql += " WHERE active = 1"
    rows = conn.execute(sql + " ORDER BY id ASC").fetchall()
    conn.close()
    return [_row_to_policy_rule(r) for r in rows]


def set_policy_rule_active(rule_id, active):
    conn = connect()
    cur = conn.execute(
        "UPDATE policy_rules SET active=? WHERE id=?", (1 if active else 0, rule_id)
    )
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0


def delete_policy_rule(rule_id):
    conn = connect()
    cur = conn.execute("DELETE FROM policy_rules WHERE id=?", (rule_id,))
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0


# ==============================================================================
# Seed data: Nexora Technologies - a B2B SaaS company selling enterprise
# subscriptions. One coherent business so every workflow relates to the others,
# which is what makes the process graph (and the conflict it's built to catch)
# mean something.
# ==============================================================================
SEED_WORKFLOWS = [
    {
        "key": "lead_qualification",
        "name": "Lead Qualification",
        "department": "Sales",
        "description": "Incoming leads are qualified and assigned to a rep before becoming an active opportunity.",
        "steps": [
            {"name": "Lead Received", "description": "Inbound lead captured from marketing or outreach."},
            {"name": "Sales Qualification", "description": "Rep checks budget, authority, need, and timeline."},
            {"name": "Account Assignment", "description": "Qualified lead is assigned to an account owner."},
            {"name": "Opportunity Created", "description": "A tracked opportunity is opened in the CRM."},
        ],
        "business_rules": [],
    },
    {
        "key": "deal_closure",
        "name": "Deal Closure",
        "department": "Sales",
        "description": "Standard path for closing a deal once terms are agreed.",
        "steps": [
            {"name": "Opportunity Won", "description": "Customer agrees to terms."},
            {"name": "Order Form Signed", "description": "Order form is executed by both parties."},
            {"name": "Deal Closed", "description": "Deal is marked closed-won in the CRM."},
        ],
        "business_rules": [],
    },
    {
        "key": "enterprise_deal_approval",
        "name": "Enterprise Deal Approval",
        "department": "Sales",
        "description": "Large deals require layered internal sign-off before they can close.",
        "steps": [
            {"name": "Large Deal Identified", "description": "Deal value crosses the enterprise threshold."},
            {"name": "Sales Director Review", "description": "Sales leadership reviews deal terms."},
            {"name": "Finance Review", "description": "Finance checks pricing, discounting, and payment terms."},
            {"name": "Legal Review", "description": "Legal reviews contract terms and risk."},
            {"name": "Executive Approval", "description": "A VP or above signs off before the deal can close."},
        ],
        "business_rules": [
            {"condition": "Deal value under 10,00,000", "path": "Sales Director review only"},
            {"condition": "Deal value 10,00,000 - 50,00,000", "path": "Sales Director + Finance review"},
            {"condition": "Deal value above 50,00,000", "path": "Sales Director + Finance + Legal + Executive approval"},
        ],
    },
    {
        "key": "contract_review",
        "name": "Contract Review",
        "department": "Legal",
        "description": "Every generated contract is reviewed for risk before execution.",
        "steps": [
            {"name": "Contract Generated", "description": "Contract drafted from the approved deal terms."},
            {"name": "Legal Review", "description": "Legal reviews clauses, liability, and terms."},
            {"name": "Risk Assessment", "description": "Non-standard terms are flagged and assessed."},
            {"name": "Approval", "description": "Legal signs off on the final contract."},
            {"name": "Contract Execution", "description": "Contract is countersigned and becomes binding."},
        ],
        "business_rules": [],
    },
    {
        "key": "finance_verification",
        "name": "Enterprise Payment Validation",
        "department": "Finance",
        "description": "Finance verifies an enterprise customer's ability to pay before onboarding starts.",
        "steps": [
            {"name": "Deal Approved", "description": "Enterprise Deal Approval has completed."},
            {"name": "Credit Assessment", "description": "Customer creditworthiness is checked."},
            {"name": "Payment Terms Validation", "description": "Payment schedule and terms are confirmed."},
            {"name": "Finance Verification Complete", "description": "Finance signs off; onboarding may begin."},
        ],
        "business_rules": [
            {"condition": "Customer is enterprise tier", "path": "Full credit assessment required"},
            {"condition": "Customer is SMB tier", "path": "Automated credit check only"},
        ],
    },
    {
        "key": "invoice_processing",
        "name": "Invoice Processing",
        "department": "Finance",
        "description": "Standard invoice intake and approval path.",
        "steps": [
            {"name": "Invoice Received", "description": "Invoice submitted by a vendor or generated internally."},
            {"name": "Budget Validation", "description": "Checked against the department's remaining budget."},
            {"name": "Payment Approval", "description": "Approved for payment per the approval policy."},
            {"name": "Payment Scheduled", "description": "Payment is scheduled with the vendor."},
        ],
        "business_rules": [
            {"condition": "Invoice under 50,000", "path": "Department approval"},
            {"condition": "Invoice 50,000 - 5,00,000", "path": "Department + Finance approval"},
            {"condition": "Invoice above 5,00,000", "path": "Department + Finance + Director approval"},
        ],
    },
    {
        "key": "customer_onboarding",
        "name": "Enterprise Customer Onboarding",
        "department": "Customer Success",
        "description": "How a new enterprise customer is brought live, once the deal and finance checks are complete.",
        "steps": [
            {"name": "Contract Signed", "description": "Contract Execution has completed."},
            {"name": "Finance Verification", "description": "Enterprise Payment Validation has completed."},
            {"name": "Customer Success Handoff", "description": "Account is handed from Sales to a CS manager."},
            {"name": "Implementation Kickoff", "description": "Kickoff call is scheduled with the customer."},
            {"name": "Technical Onboarding", "description": "Integrations and technical setup are completed."},
            {"name": "Customer Activation", "description": "Customer is live on the platform."},
        ],
        "business_rules": [
            {"condition": "Customer is enterprise tier", "path": "Finance Verification is mandatory before handoff"},
        ],
    },
    {
        "key": "customer_escalation",
        "name": "Customer Escalation",
        "department": "Support",
        "description": "How a customer-reported issue is escalated when standard support can't resolve it.",
        "steps": [
            {"name": "Issue Reported", "description": "Customer opens a support ticket."},
            {"name": "Tier 1 Triage", "description": "Support attempts standard resolution."},
            {"name": "Escalation to CS", "description": "Unresolved issue is escalated to Customer Success."},
            {"name": "Resolution or Executive Review", "description": "Issue is resolved or escalated further."},
        ],
        "business_rules": [],
    },
    {
        "key": "purchase_request",
        "name": "Purchase Request",
        "department": "Procurement",
        "description": "Internal request for a new vendor purchase.",
        "steps": [
            {"name": "Request Submitted", "description": "Employee submits a purchase request."},
            {"name": "Manager Approval", "description": "Direct manager approves the request."},
            {"name": "Procurement Review", "description": "Procurement checks vendor and pricing."},
        ],
        "business_rules": [],
    },
    {
        "key": "vendor_approval",
        "name": "Vendor Approval",
        "department": "Procurement",
        "description": "New vendors are vetted before a contract can be signed with them.",
        "steps": [
            {"name": "Vendor Proposed", "description": "A new vendor is proposed via Purchase Request."},
            {"name": "Security Review", "description": "Vendor's data handling is reviewed."},
            {"name": "Vendor Approved", "description": "Vendor is added to the approved list."},
        ],
        "business_rules": [],
    },
]

# Dependency edges, expressed by seed "key" and resolved to ids after insert.
# One path in, deliberately: Deal Closure only reaches Onboarding through the
# approval -> contract -> finance chain. That single path is what makes "skip
# straight to Onboarding" a detectable, meaningful conflict rather than one
# of several equally valid routes.
SEED_DEPENDENCIES = [
    ("lead_qualification", "deal_closure", "precedes", "Qualified opportunity can be closed"),
    ("deal_closure", "enterprise_deal_approval", "triggers", "Large deals require layered approval"),
    ("enterprise_deal_approval", "contract_review", "precedes", "Approved deal generates a contract"),
    ("contract_review", "finance_verification", "precedes", "Executed contract enables payment validation"),
    ("finance_verification", "customer_onboarding", "requires", "Finance sign-off required before onboarding"),
    ("customer_onboarding", "customer_escalation", "precedes", "Escalations occur post-activation"),
    ("purchase_request", "vendor_approval", "triggers", "New vendor triggers approval"),
    ("purchase_request", "invoice_processing", "precedes", "Approved purchase generates an invoice"),
]

# Policy documents + the rules extracted from them (pre-compiled so the demo
# doesn't depend on an LLM call to have policies present at first load).
SEED_POLICY_DOCUMENTS = [
    {
        "filename": "enterprise-onboarding-policy.txt",
        "raw_text": (
            "Enterprise Customer Onboarding Policy\n\n"
            "Enterprise customers must complete financial verification before "
            "onboarding begins. Customer Success may not hand off an account "
            "or begin implementation until Finance has confirmed payment terms "
            "and creditworthiness."
        ),
        "rules": [
            {
                "title": "Enterprise Onboarding Policy",
                "text": "Enterprise customers must complete financial verification before onboarding begins.",
                "department": "Customer Success",
                "compiled": {
                    "type": "require_precedes",
                    "required_workflow": "Enterprise Payment Validation",
                    "before_step": "Customer Success Handoff",
                    "applies_when": {"field": "customer_tier", "equals": "enterprise"},
                },
            },
        ],
    },
    {
        "filename": "deal-approval-policy.txt",
        "raw_text": (
            "Deal Approval Policy\n\n"
            "Deals above Rs. 10,00,000 require Finance approval before any "
            "downstream operational process - including onboarding, "
            "implementation, or customer success handoff - may begin."
        ),
        "rules": [
            {
                "title": "Deal Approval Policy",
                "text": "Deals above 10,00,000 require Finance approval before downstream operational processes may begin.",
                "department": "Finance",
                "compiled": {
                    "type": "require_approval_above",
                    "field": "deal_value",
                    "threshold": 1000000,
                    "approver": "Finance",
                    "blocks_steps": ["Customer Success Handoff", "Implementation Kickoff"],
                },
            },
        ],
    },
    {
        "filename": "vendor-security-policy.txt",
        "raw_text": (
            "Vendor Security Policy\n\n"
            "No new vendor may be paid until Procurement has completed a "
            "security review and added the vendor to the approved list."
        ),
        "rules": [
            {
                "title": "Vendor Security Policy",
                "text": "No new vendor may be paid until a security review is complete and the vendor is approved.",
                "department": "Procurement",
                "compiled": {
                    "type": "require_precedes",
                    "required_workflow": "Vendor Approval",
                    "before_step": "Payment Scheduled",
                },
            },
        ],
    },
]


def _seed():
    key_to_id = {}
    for wf in SEED_WORKFLOWS:
        saved = insert_workflow(
            {k: v for k, v in wf.items() if k != "key"}, status="active"
        )
        key_to_id[wf["key"]] = saved["id"]

    for from_key, to_key, rel, label in SEED_DEPENDENCIES:
        add_dependency(key_to_id[from_key], key_to_id[to_key], rel, label)

    for doc in SEED_POLICY_DOCUMENTS:
        doc_id = insert_policy_document(doc["filename"], doc["raw_text"])
        for rule in doc["rules"]:
            insert_policy_rule(
                doc_id, rule["title"], rule["text"], rule["department"], rule["compiled"]
            )
