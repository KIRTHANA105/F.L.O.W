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
    created_at    TEXT    NOT NULL
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
    }


def insert_workflow(wf):
    conn = connect()
    cur = conn.execute(
        """INSERT INTO workflows
           (name, source_system, trigger, trigger_type, conditions, actions,
            priority, status, raw_text, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
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
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
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
SEED_WORKFLOWS = [
    {
        "name": "Stale pending orders escalation",
        "source_system": "Internal",
        "trigger": "Order status change",
        "trigger_type": "order_status_change",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "pending", "display": "status is pending"},
            {"field": "hours_since_update", "operator": ">", "value": 72, "display": "pending for more than 72 hours"},
        ],
        "actions": [
            {"type": "notify", "target": "operations", "display": "Notify operations team"},
        ],
        "priority": "medium",
        "raw_text": "If an order sits in pending for over 72 hours, notify the operations team.",
    },
    {
        "name": "Auto-approve small invoices",
        "source_system": "ERPNext",
        "trigger": "Invoice submitted",
        "trigger_type": "invoice_submitted",
        "conditions": [
            {"field": "amount", "operator": "<", "value": 50000, "display": "amount is under 50,000"},
        ],
        "actions": [
            {"type": "approve", "target": "finance", "display": "Auto-approve the invoice"},
        ],
        "priority": "high",
        "raw_text": "When an invoice is submitted for less than 50000, auto-approve it.",
    },
    {
        "name": "High-value shipment insurance check",
        "source_system": "Zoho",
        "trigger": "Shipment created",
        "trigger_type": "shipment_created",
        "conditions": [
            {"field": "amount", "operator": ">", "value": 100000, "display": "amount is over 100,000"},
        ],
        "actions": [
            {"type": "notify", "target": "logistics", "display": "Alert logistics to add insurance"},
        ],
        "priority": "medium",
        "raw_text": "Shipments worth more than 100000 need an insurance check by logistics.",
    },
]


def init_db(force_reseed=False):
    """Create the schema and seed starter workflows when the table is empty."""
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM workflows").fetchone()["c"]
    conn.close()

    if force_reseed and count:
        conn = connect()
        conn.execute("DELETE FROM workflows")
        conn.commit()
        conn.close()
        count = 0

    if count == 0:
        for wf in SEED_WORKFLOWS:
            insert_workflow(dict(wf, status="active"))
        return len(SEED_WORKFLOWS)
    return 0
