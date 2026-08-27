"""Static connector catalog for FLOW triggers and actions."""

def paths_overlap(a: str, b: str) -> bool:
    """Exact match, or either side ends in '.*' and prefixes match."""
    if not a or not b:
        return False
    if a == b:
        return True
    if a.endswith(".*"):
        prefix = a[:-2]
        if b == prefix or b.startswith(prefix + "."):
            return True
    if b.endswith(".*"):
        prefix = b[:-2]
        if a == prefix or a.startswith(prefix + "."):
            return True
    return False


TRIGGERS = [
    {
        "trigger_id": "form.submitted",
        "app": "Forms",
        "label": "Form Submitted",
        "event_fields": [
            {"name": "form_id", "type": "text"},
            {"name": "response_id", "type": "text"},
            {"name": "email", "type": "email"},
            {"name": "answers", "type": "text"},
        ],
        "listens": ["form.submission"],
    },
    {
        "trigger_id": "hubspot.contact_updated",
        "app": "HubSpot",
        "label": "Contact Updated",
        "event_fields": [
            {"name": "contact_id", "type": "text"},
            {"name": "email", "type": "email"},
            {"name": "properties", "type": "text"},
        ],
        "listens": ["hubspot.contact.*"],
    },
    {
        "trigger_id": "sheets.row_added",
        "app": "Google Sheets",
        "label": "New Row Added",
        "event_fields": [
            {"name": "spreadsheet_id", "type": "text"},
            {"name": "row_index", "type": "number"},
            {"name": "row_data", "type": "text"},
        ],
        "listens": ["sheets.row"],
    },
    {
        "trigger_id": "schedule.cron",
        "app": "Schedule",
        "label": "Cron Schedule",
        "event_fields": [
            {"name": "schedule_id", "type": "text"},
            {"name": "timestamp", "type": "date"},
        ],
        "listens": [],
    },
    {
        "trigger_id": "webhook.received",
        "app": "Webhooks",
        "label": "Webhook Received",
        "event_fields": [
            {"name": "event_type", "type": "text"},
            {"name": "payload", "type": "text"},
            {"name": "sender_email", "type": "email"},
        ],
        "listens": ["webhook.event"],
    },
]

ACTIONS = [
    {
        "operation_id": "gmail.send",
        "app": "Gmail",
        "label": "Send an email",
        "inputs": [
            {"name": "to", "type": "email", "required": True},
            {"name": "subject", "type": "text", "required": True},
            {"name": "body", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "message_id", "type": "text"},
            {"name": "sent_at", "type": "date"},
            {"name": "status", "type": "text"},
        ],
        "writes": ["gmail.message"],
        "side_effect": "write",
        "damage": 4,
        "avg_latency_ms": 350,
    },
    {
        "operation_id": "slack.post",
        "app": "Slack",
        "label": "Post message to Slack",
        "inputs": [
            {"name": "channel", "type": "text", "required": True},
            {"name": "message", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "message_ts", "type": "text"},
            {"name": "channel_id", "type": "text"},
            {"name": "delivered", "type": "boolean"},
        ],
        "writes": ["slack.message"],
        "side_effect": "write",
        "damage": 2,
        "avg_latency_ms": 200,
    },
    {
        "operation_id": "sheets.append_row",
        "app": "Google Sheets",
        "label": "Append row to sheet",
        "inputs": [
            {"name": "spreadsheet_id", "type": "text", "required": True},
            {"name": "values", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "updated_range", "type": "text"},
            {"name": "row_index", "type": "number"},
            {"name": "success", "type": "boolean"},
        ],
        "writes": ["sheets.row"],
        "side_effect": "write",
        "damage": 1,
        "avg_latency_ms": 450,
    },
    {
        "operation_id": "sheets.read",
        "app": "Google Sheets",
        "label": "Read rows from sheet",
        "inputs": [
            {"name": "spreadsheet_id", "type": "text", "required": True},
            {"name": "range", "type": "text", "required": False},
        ],
        "outputs": [
            {"name": "rows", "type": "text"},
            {"name": "row_count", "type": "number"},
        ],
        "writes": [],
        "side_effect": "read",
        "damage": 1,
        "avg_latency_ms": 400,
    },
    {
        "operation_id": "hubspot.lookup_contact",
        "app": "HubSpot",
        "label": "Lookup contact by email",
        "inputs": [
            {"name": "email", "type": "email", "required": True},
        ],
        "outputs": [
            {"name": "contact_id", "type": "text"},
            {"name": "first_name", "type": "text"},
            {"name": "last_name", "type": "text"},
            {"name": "lifecycle_stage", "type": "text"},
        ],
        "writes": [],
        "side_effect": "read",
        "damage": 1,
        "avg_latency_ms": 300,
    },
    {
        "operation_id": "hubspot.update_contact",
        "app": "HubSpot",
        "label": "Update contact properties",
        "inputs": [
            {"name": "contact_id", "type": "text", "required": True},
            {"name": "properties", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "contact_id", "type": "text"},
            {"name": "updated_at", "type": "date"},
            {"name": "success", "type": "boolean"},
        ],
        "writes": ["hubspot.contact.owner_id"],
        "side_effect": "write",
        "damage": 3,
        "avg_latency_ms": 350,
    },
    {
        "operation_id": "hubspot.update_stage",
        "app": "HubSpot",
        "label": "Update contact lifecycle stage",
        "inputs": [
            {"name": "contact_id", "type": "text", "required": True},
            {"name": "lifecycle_stage", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "contact_id", "type": "text"},
            {"name": "lifecycle_stage", "type": "text"},
            {"name": "success", "type": "boolean"},
        ],
        "writes": ["hubspot.contact.lifecycle_stage"],
        "side_effect": "write",
        "damage": 3,
        "avg_latency_ms": 300,
    },
    {
        "operation_id": "hubspot.assign_owner",
        "app": "HubSpot",
        "label": "Assign contact owner",
        "inputs": [
            {"name": "contact_id", "type": "text", "required": True},
            {"name": "owner_id", "type": "text", "required": True},
        ],
        "outputs": [
            {"name": "contact_id", "type": "text"},
            {"name": "owner_id", "type": "text"},
            {"name": "success", "type": "boolean"},
        ],
        "writes": ["hubspot.contact.owner_id"],
        "side_effect": "write",
        "damage": 3,
        "avg_latency_ms": 250,
    },
    {
        "operation_id": "stripe.refund",
        "app": "Stripe",
        "label": "Issue refund",
        "inputs": [
            {"name": "charge_id", "type": "text", "required": True},
            {"name": "amount", "type": "number", "required": True},
            {"name": "reason", "type": "text", "required": False},
        ],
        "outputs": [
            {"name": "refund_id", "type": "text"},
            {"name": "amount_refunded", "type": "number"},
            {"name": "status", "type": "text"},
        ],
        "writes": ["stripe.refund"],
        "side_effect": "irreversible",
        "damage": 10,
        "avg_latency_ms": 600,
    },
    {
        "operation_id": "account.delete",
        "app": "Account Service",
        "label": "Permanently delete account",
        "inputs": [
            {"name": "account_id", "type": "text", "required": True},
            {"name": "confirm", "type": "boolean", "required": True},
        ],
        "outputs": [
            {"name": "account_id", "type": "text"},
            {"name": "deleted_at", "type": "date"},
            {"name": "status", "type": "text"},
        ],
        "writes": ["account.data", "user.profile"],
        "side_effect": "irreversible",
        "damage": 10,
        "avg_latency_ms": 800,
    },
]

ACTIONS_BY_ID = {action["operation_id"]: action for action in ACTIONS}
TRIGGERS_BY_ID = {trigger["trigger_id"]: trigger for trigger in TRIGGERS}


def get_catalog() -> dict:
    """Return all triggers and actions."""
    return {
        "triggers": TRIGGERS,
        "actions": ACTIONS,
    }


def get_action(operation_id: str) -> dict | None:
    """Lookup action by operation_id."""
    return ACTIONS_BY_ID.get(operation_id)


def get_trigger(trigger_id: str) -> dict | None:
    """Lookup trigger by trigger_id."""
    return TRIGGERS_BY_ID.get(trigger_id)
