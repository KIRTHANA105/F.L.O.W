"""Capability registry - the vocabulary that makes reuse detectable.

A capability is one atomic unit of work, named `domain.operation`. Two workflows
that both notify sales provide the SAME capability even if their rules are worded
completely differently. That shared vocabulary is what lets FLOW answer
"you already built this" instead of generating a duplicate.

The registry is a fixed list on purpose: the LLM picks from it rather than
inventing names, so matching stays deterministic string equality.
"""

# domain.operation -> human description shown in the Memory Match card.
REGISTRY = {
    # Finance
    "finance.approve_invoice": "Approve an invoice for payment",
    "finance.flag_invoice": "Flag an invoice for manual review",
    "finance.release_payment": "Release a vendor payment",
    "finance.request_approval": "Request approval from a finance approver",
    # CRM / Sales
    "crm.create_record": "Create a customer or lead record in the CRM",
    "crm.update_record": "Update an existing CRM record",
    "crm.assign_owner": "Assign an account owner or rep",
    "notify.sales_team": "Notify the sales team",
    # Operations / warehouse
    "notify.warehouse": "Alert the warehouse team",
    "ops.flag_dashboard": "Raise a flag on the operations dashboard",
    "ops.escalate_order": "Escalate a delayed order",
    "ops.hold_shipment": "Place a hold on a shipment",
    # People / access
    "access.grant_seat": "Grant a software seat or license",
    "access.revoke_seat": "Revoke a software seat or license",
    "hr.enroll_benefits": "Enroll an employee in benefits",
    "payroll.enroll": "Add an employee to payroll",
    # Generic
    "notify.manager": "Notify a manager",
    "notify.finance_team": "Notify the finance team",
    "audit.log_event": "Write an entry to the audit log",
    "support.create_ticket": "Create a support ticket",
}

KEYS = sorted(REGISTRY.keys())


def describe(key):
    return REGISTRY.get(key, key)


def is_known(key):
    return key in REGISTRY


# Map an action's verb+target onto a capability, so workflows created before
# capabilities existed still register what they provide.
_ACTION_HINTS = [
    (("approve",), ("invoice", "finance", "payment"), "finance.approve_invoice"),
    (("flag", "review", "hold"), ("invoice", "finance"), "finance.flag_invoice"),
    (("release",), ("payment", "vendor"), "finance.release_payment"),
    (("notify", "alert"), ("warehouse",), "notify.warehouse"),
    (("notify", "alert"), ("sales",), "notify.sales_team"),
    (("notify", "alert"), ("finance",), "notify.finance_team"),
    (("notify", "alert"), ("manager", "operations", "ops"), "notify.manager"),
    (("flag",), ("dashboard",), "ops.flag_dashboard"),
    (("escalate",), (), "ops.escalate_order"),
    (("hold", "block"), ("shipment", "logistics"), "ops.hold_shipment"),
    (("create",), ("crm", "record", "customer", "lead"), "crm.create_record"),
    (("assign",), ("rep", "owner", "senior"), "crm.assign_owner"),
    (("grant",), ("seat", "license", "github", "access"), "access.grant_seat"),
    (("enroll",), ("payroll",), "payroll.enroll"),
    (("ticket",), (), "support.create_ticket"),
]


def infer_from_action(action):
    """Best-effort capability for one action dict. None when nothing matches."""
    text = " ".join(
        str(action.get(k, "")) for k in ("type", "target", "display")
    ).lower()
    for verbs, nouns, key in _ACTION_HINTS:
        if not any(v in text for v in verbs):
            continue
        if nouns and not any(n in text for n in nouns):
            continue
        return key
    return None


def infer_from_workflow(workflow):
    """All capabilities a workflow provides, inferred from its actions."""
    found = []
    for action in workflow.get("actions", []) or []:
        key = infer_from_action(action)
        if key and key not in found:
            found.append(key)
    return found
