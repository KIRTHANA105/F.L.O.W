"""SQLite persistence for FLOW workflows."""
import json
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "flow.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    source_system TEXT    NOT NULL,
    trigger       TEXT    NOT NULL,
    trigger_type  TEXT    NOT NULL,
    conditions    TEXT    NOT NULL,
    actions       TEXT    NOT NULL,
    priority      TEXT    NOT NULL DEFAULT 'medium',
    status        TEXT    NOT NULL DEFAULT 'active',
    raw_text      TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL,
    last_match_count INTEGER NOT NULL DEFAULT 0,
    department    TEXT    NOT NULL DEFAULT 'Ops'
);

CREATE TABLE IF NOT EXISTS capabilities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wf_capabilities (
    workflow_id   INTEGER NOT NULL,
    capability_id INTEGER NOT NULL,
    PRIMARY KEY (workflow_id, capability_id)
);

CREATE TABLE IF NOT EXISTS policies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    text          TEXT NOT NULL,
    department    TEXT NOT NULL DEFAULT 'Ops',
    compiled_json TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);
"""


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_workflow(row):
    """Turn a DB row into the JSON shape the frontend consumes."""
    return {
        "id": row["id"],
        "name": row["name"],
        "source_system": row["source_system"],
        "trigger": row["trigger"],
        "trigger_type": row["trigger_type"],
        "conditions": json.loads(row["conditions"]),
        "actions": json.loads(row["actions"]),
        "priority": row["priority"],
        "status": row["status"],
        "raw_text": row["raw_text"],
        "created_at": row["created_at"],
        "last_match_count": row["last_match_count"],
        "department": row["department"],
        "capabilities": capabilities_for_workflow(row["id"]),
    }


def insert_workflow(wf):
    conn = connect()
    cur = conn.execute(
        """INSERT INTO workflows
           (name, source_system, trigger, trigger_type, conditions, actions,
               priority, status, raw_text, created_at, last_match_count, department)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            wf.get("name") or "Untitled rule",
            wf.get("source_system", "Internal"),
            wf.get("trigger", ""),
            wf.get("trigger_type", "other"),
            json.dumps(wf.get("conditions", [])),
            json.dumps(wf.get("actions", [])),
            wf.get("priority", "medium"),
            wf.get("status", "active"),
            wf.get("raw_text", ""),
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
            wf.get("last_match_count", 0),
            wf.get("department") or "Ops",
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    # Register what this workflow provides, so future requests can reuse it.
    import capabilities as cap
    keys = wf.get("capabilities") or cap.infer_from_workflow(wf)
    set_workflow_capabilities(new_id, keys, describe=cap.describe)

    conn = connect()
    row = conn.execute("SELECT * FROM workflows WHERE id=?", (new_id,)).fetchone()
    conn.close()
    return row_to_workflow(row)


def list_workflows():
    conn = connect()
    rows = conn.execute("SELECT * FROM workflows ORDER BY id ASC").fetchall()
    conn.close()
    return [row_to_workflow(r) for r in rows]


def delete_workflow(wf_id):
    conn = connect()
    cur = conn.execute("DELETE FROM workflows WHERE id=?", (wf_id,))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    return deleted > 0


# --- Seed data -------------------------------------------------------------
# Rule #2 (ERPNext auto-approve under 50000) is the deliberate trap: the rule
# created live during the demo (Zoho, flag above 30000) contradicts it in the
# 30000-50000 band.
# Sundar Textiles - a manufacturer with 18 months of accumulated automation.
# The point of this seed is that memory ALREADY EXISTS when the demo starts:
# the Memory Match card can only say "you built this in January" if January
# is in the database. Rule #2 is also the deliberate conflict trap.
SEED_WORKFLOWS = [
    {
        "name": "Stale pending orders escalation",
        "source_system": "Internal",
        "department": "Ops",
        "trigger": "Order status change",
        "trigger_type": "order_status_change",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "pending", "display": "status is pending"},
            {"field": "hours_since_update", "operator": ">", "value": 72, "display": "pending for more than 72 hours"},
        ],
        "actions": [
            {"type": "notify", "target": "operations", "display": "Notify operations team"},
        ],
        "capabilities": ["notify.manager", "ops.escalate_order"],
        "priority": "medium",
        "raw_text": "If an order sits in pending for over 72 hours, notify the operations team.",
    },
    {
        "name": "Auto-approve small invoices",
        "source_system": "ERPNext",
        "department": "Finance",
        "trigger": "Invoice submitted",
        "trigger_type": "invoice_submitted",
        "conditions": [
            {"field": "amount", "operator": "<", "value": 50000, "display": "amount is under 50,000"},
        ],
        "actions": [
            {"type": "approve", "target": "finance", "display": "Auto-approve the invoice"},
        ],
        "capabilities": ["finance.approve_invoice"],
        "priority": "high",
        "raw_text": "When an invoice is submitted for less than 50000, auto-approve it.",
    },
    {
        "name": "Vendor payment release",
        "source_system": "ERPNext",
        "department": "Finance",
        "trigger": "Invoice submitted",
        "trigger_type": "invoice_submitted",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "approved", "display": "invoice is approved"},
        ],
        "actions": [
            {"type": "release", "target": "vendor payment", "display": "Release the vendor payment"},
        ],
        "capabilities": ["finance.release_payment"],
        "priority": "medium",
        "raw_text": "Once an invoice is approved, release the vendor payment.",
    },
    {
        "name": "Lead intake to CRM",
        "source_system": "Zoho",
        "department": "Sales",
        "trigger": "Customer created",
        "trigger_type": "customer_created",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "new", "display": "customer is new"},
        ],
        "actions": [
            {"type": "create", "target": "crm record", "display": "Create a CRM record"},
        ],
        "capabilities": ["crm.create_record"],
        "priority": "medium",
        "raw_text": "When a new customer signs up, create a CRM record.",
    },
    {
        "name": "Deal alerts to sales",
        "source_system": "Zoho",
        "department": "Sales",
        "trigger": "Customer created",
        "trigger_type": "customer_created",
        "conditions": [
            {"field": "amount", "operator": ">", "value": 25000, "display": "deal value over 25,000"},
        ],
        "actions": [
            {"type": "notify", "target": "sales", "display": "Notify the sales team"},
        ],
        "capabilities": ["notify.sales_team"],
        "priority": "medium",
        "raw_text": "Alert the sales team when a deal is worth more than 25000.",
    },
    {
        "name": "New hire payroll enrolment",
        "source_system": "Internal",
        "department": "HR",
        "trigger": "Employee created",
        "trigger_type": "employee_created",
        "conditions": [
            {"field": "employment_type", "operator": "equals", "value": "full_time",
             "display": "employee is full time"},
        ],
        "actions": [
            {"type": "enroll", "target": "payroll", "display": "Add the employee to payroll"},
            {"type": "notify", "target": "finance", "display": "Notify the finance team"},
        ],
        # notify.finance_team is also used by Finance - proves cross-department sharing.
        "capabilities": ["payroll.enroll", "notify.finance_team"],
        "priority": "high",
        "raw_text": "When a full-time employee joins, add them to payroll and tell finance.",
    },
    {
        "name": "Month-end finance digest",
        "source_system": "ERPNext",
        "department": "Finance",
        "trigger": "Invoice submitted",
        "trigger_type": "invoice_submitted",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "approved",
             "display": "invoice is approved"},
        ],
        "actions": [
            {"type": "notify", "target": "finance", "display": "Notify the finance team"},
        ],
        "capabilities": ["notify.finance_team"],
        "priority": "low",
        "raw_text": "Tell finance whenever an invoice is approved.",
    },
    {
        "name": "Access provisioning",
        "source_system": "Internal",
        "department": "IT",
        "trigger": "Employee created",
        "trigger_type": "employee_created",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "active", "display": "employee is active"},
        ],
        "actions": [
            {"type": "grant", "target": "seat", "display": "Grant a software seat"},
        ],
        "capabilities": ["access.grant_seat"],
        "priority": "low",
        "raw_text": "New active employees get a software seat provisioned.",
    },
]


# Policies compiled from plain English at signup. `forbid` blocks a capability
# outright; `require_approval_above` demands sign-off past a money threshold.
SEED_POLICIES = [
    {
        "text": "Purchases over 80,000 need CFO approval.",
        "department": "Finance",
        "compiled": {
            "type": "require_approval_above",
            "field": "amount",
            "threshold": 80000,
            "approver": "CFO",
            "applies_to": ["finance.approve_invoice", "finance.release_payment"],
        },
    },
    {
        "text": "Anything flagged for manual review can never be auto-approved.",
        "department": "Finance",
        "compiled": {
            "type": "forbid",
            "forbid_capability": "finance.approve_invoice",
            "when_capability": "finance.flag_invoice",
        },
    },
    {
        "text": "Contractors don't get software seats.",
        "department": "IT",
        "compiled": {
            "type": "forbid",
            "forbid_capability": "access.grant_seat",
            "when": {"field": "employment_type", "equals": "contractor"},
        },
    },
]


def init_db(force_reseed=False):
    """Create the schema and seed starter workflows when the table is empty."""
    conn = connect()
    conn.executescript(SCHEMA)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(workflows)")}
    if "last_match_count" not in columns:
        conn.execute(
            "ALTER TABLE workflows ADD COLUMN last_match_count INTEGER NOT NULL DEFAULT 0"
        )
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM workflows").fetchone()["c"]
    conn.close()

    if force_reseed and count:
        conn = connect()
        conn.execute("DELETE FROM workflows")
        conn.execute("DELETE FROM wf_capabilities")
        conn.execute("DELETE FROM capabilities")
        conn.execute("DELETE FROM policies")
        conn.commit()
        conn.close()
        count = 0

    seeded = 0
    if count == 0:
        for wf in SEED_WORKFLOWS:
            insert_workflow(dict(wf, status="active"))
        seeded = len(SEED_WORKFLOWS)

    conn = connect()
    pol_count = conn.execute("SELECT COUNT(*) AS c FROM policies").fetchone()["c"]
    conn.close()
    if pol_count == 0:
        for pol in SEED_POLICIES:
            insert_policy(pol["text"], pol["department"], pol["compiled"])

    return seeded


def update_last_match_count(wf_id, match_count):
    conn = connect()
    conn.execute(
        "UPDATE workflows SET last_match_count=? WHERE id=?",
        (match_count, wf_id),
    )
    conn.commit()
    conn.close()


def update_workflow_field(wf_id, field, value):
    if field not in {"conditions", "priority"}:
        return False
    stored_value = json.dumps(value) if field == "conditions" else value
    conn = connect()
    cur = conn.execute(
        f"UPDATE workflows SET {field}=? WHERE id=?",
        (stored_value, wf_id),
    )
    conn.commit()
    conn.close()
    return cur.rowcount > 0


# --- Capabilities (the Business Process Memory) ----------------------------
def upsert_capability(key, description=""):
    """Register a capability key, returning its row id."""
    conn = connect()
    conn.execute(
        "INSERT OR IGNORE INTO capabilities (key, description) VALUES (?,?)",
        (key, description),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM capabilities WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["id"]


def link_capability(workflow_id, key, description=""):
    cap_id = upsert_capability(key, description)
    conn = connect()
    conn.execute(
        "INSERT OR IGNORE INTO wf_capabilities (workflow_id, capability_id) VALUES (?,?)",
        (workflow_id, cap_id),
    )
    conn.commit()
    conn.close()


def set_workflow_capabilities(workflow_id, keys, describe=None):
    for key in keys or []:
        link_capability(workflow_id, key, describe(key) if describe else "")


def capabilities_for_workflow(workflow_id):
    conn = connect()
    rows = conn.execute(
        """SELECT c.key FROM capabilities c
           JOIN wf_capabilities wc ON wc.capability_id = c.id
           WHERE wc.workflow_id = ? ORDER BY c.key""",
        (workflow_id,),
    ).fetchall()
    conn.close()
    return [r["key"] for r in rows]


def capability_map():
    """capability key -> the active workflows providing it.

    This is the query behind the Memory Match card: it answers
    "who already does this?" for any capability the user asks for.
    """
    conn = connect()
    rows = conn.execute(
        """SELECT c.key AS key, w.id AS wid, w.name AS name,
                  w.department AS department, w.source_system AS source_system,
                  w.created_at AS created_at
           FROM capabilities c
           JOIN wf_capabilities wc ON wc.capability_id = c.id
           JOIN workflows w        ON w.id = wc.workflow_id
           WHERE w.status = 'active'
           ORDER BY c.key, w.id"""
    ).fetchall()
    conn.close()
    out = {}
    for r in rows:
        out.setdefault(r["key"], []).append({
            "workflow_id": r["wid"],
            "name": r["name"],
            "department": r["department"],
            "source_system": r["source_system"],
            "created_at": r["created_at"],
        })
    return out


# --- Policies (the rules that govern rules) --------------------------------
def insert_policy(text, department, compiled, active=True):
    conn = connect()
    cur = conn.execute(
        """INSERT INTO policies (text, department, compiled_json, active, created_at)
           VALUES (?,?,?,?,?)""",
        (
            text,
            department or "Ops",
            json.dumps(compiled),
            1 if active else 0,
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return get_policy(new_id)


def _row_to_policy(row):
    return {
        "id": row["id"],
        "text": row["text"],
        "department": row["department"],
        "compiled": json.loads(row["compiled_json"]),
        "active": bool(row["active"]),
        "created_at": row["created_at"],
    }


def get_policy(policy_id):
    conn = connect()
    row = conn.execute("SELECT * FROM policies WHERE id=?", (policy_id,)).fetchone()
    conn.close()
    return _row_to_policy(row) if row else None


def list_policies(active_only=False):
    conn = connect()
    sql = "SELECT * FROM policies"
    if active_only:
        sql += " WHERE active = 1"
    rows = conn.execute(sql + " ORDER BY id ASC").fetchall()
    conn.close()
    return [_row_to_policy(r) for r in rows]


def set_policy_active(policy_id, active):
    conn = connect()
    cur = conn.execute(
        "UPDATE policies SET active=? WHERE id=?", (1 if active else 0, policy_id)
    )
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0


def delete_policy(policy_id):
    conn = connect()
    cur = conn.execute("DELETE FROM policies WHERE id=?", (policy_id,))
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return changed > 0
