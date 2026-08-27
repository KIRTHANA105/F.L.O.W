"""Deterministic Simulation Engine for FLOW Workflows.

Features:
- Connector layer isolation (Real vs Mock)
- Virtual clock (ms) — wait steps advance clock instantly, never sleep()
- Variable scoping with $.path resolution
- Condition branching evaluation
- Faker-based deterministic data generator seeded per scenario
- Scenario generator for edge conditions and failure injections
- Comprehensive execution trace and bug detection
"""

import json
import re
from typing import Any, Dict, List, Optional
from faker import Faker

import catalog
from connectors import ConnectorLayer, MockConnectors

# In-memory storage for last simulation run per workflow
LAST_SIMULATION_REPORTS: Dict[int, Dict[str, Any]] = {}


def parse_wait_duration_ms(text: str) -> int:
    """Parse time durations like 'wait 2 days', 'wait 1 hour', 'wait 30 minutes' into ms."""
    if not text:
        return 0
    t = text.lower()
    
    # Days
    m = re.search(r"(\d+(?:\.\d+)?)\s*day", t)
    if m:
        return int(float(m.group(1)) * 86400 * 1000)
    
    # Hours
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:hour|hr)", t)
    if m:
        return int(float(m.group(1)) * 3600 * 1000)
    
    # Minutes
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:minute|min)", t)
    if m:
        return int(float(m.group(1)) * 60 * 1000)
    
    # Seconds
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:second|sec)", t)
    if m:
        return int(float(m.group(1)) * 1000)
    
    # Milliseconds
    m = re.search(r"(\d+)\s*ms", t)
    if m:
        return int(m.group(1))
    
    return 0


def generate_value_by_type(val_type: str, fake: Faker) -> Any:
    """Generate fake data matching schema type using seeded Faker."""
    t = val_type.lower()
    if t == "email":
        return fake.email()
    elif t == "number":
        return fake.random_int(min=10, max=10000)
    elif t == "boolean":
        return fake.boolean()
    elif t == "date":
        return fake.date_this_year().isoformat()
    elif t == "text":
        return fake.word()
    return fake.word()


def generate_action_output(operation_id: str, fake: Faker) -> Dict[str, Any]:
    """Generate deterministic output for a catalog action using Faker."""
    action = catalog.get_action(operation_id)
    if not action:
        return {"result": fake.word(), "success": True}
    
    output = {}
    for out in action.get("outputs", []):
        output[out["name"]] = generate_value_by_type(out["type"], fake)
    return output


def resolve_json_path(path_expr: str, scope: Dict[str, Any]) -> Any:
    """Resolve JSON path expressions like '$.company.employees' or '$.deal.amount' against scope."""
    if not isinstance(path_expr, str) or not path_expr.startswith("$."):
        return path_expr
    
    parts = path_expr[2:].split(".")
    curr = scope
    for part in parts:
        if isinstance(curr, dict) and part in curr:
            curr = curr[part]
        else:
            return None
    return curr


def resolve_inputs(inputs: Dict[str, Any], scope: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve all input values against variable scope."""
    resolved = {}
    for k, v in inputs.items():
        if isinstance(v, str) and v.startswith("$."):
            resolved[k] = resolve_json_path(v, scope)
        elif isinstance(v, dict):
            resolved[k] = resolve_inputs(v, scope)
        else:
            resolved[k] = v
    return resolved


def evaluate_condition(cond_str: str, scope: Dict[str, Any]) -> bool:
    """Deterministically evaluate condition expression against scope."""
    if not cond_str:
        return True
    
    c = cond_str.strip()
    
    # Check is_empty
    m = re.match(r"(?:is_empty|empty)\((.+?)\)", c, re.IGNORECASE)
    if m:
        field = m.group(1).strip()
        val = resolve_json_path(field if field.startswith("$.") else f"$.{field}", scope)
        return val is None or val == "" or val == [] or val == {}

    # Check "in [a, b, c]"
    m = re.match(r"(.+?)\s+in\s+\[(.*?)\]", c, re.IGNORECASE)
    if m:
        field = m.group(1).strip()
        val = resolve_json_path(field if field.startswith("$.") else f"$.{field}", scope)
        candidates = [item.strip().strip("'\"") for item in m.group(2).split(",") if item.strip()]
        return str(val) in candidates

    # Check numeric / comparison operators
    m = re.match(r"(.+?)\s*(>=|<=|>|<|==|!=|=)\s*(.+)", c)
    if m:
        left_expr = m.group(1).strip()
        op = m.group(2)
        right_expr = m.group(3).strip().strip("'\"")
        
        left_val = resolve_json_path(left_expr if left_expr.startswith("$.") else f"$.{left_expr}", scope)
        if left_val is None:
            # Fallback search anywhere in scope
            for k, v in scope.items():
                if isinstance(v, dict) and left_expr in v:
                    left_val = v[left_expr]
                    break
        
        # Try numeric comparison
        try:
            l_num = float(left_val) if left_val is not None else 0.0
            r_num = float(right_expr.replace(",", ""))
            if op in (">",):
                return l_num > r_num
            elif op in (">=",):
                return l_num >= r_num
            elif op in ("<",):
                return l_num < r_num
            elif op in ("<=",):
                return l_num <= r_num
            elif op in ("==", "="):
                return l_num == r_num
            elif op in ("!=",):
                return l_num != r_num
        except (ValueError, TypeError):
            # Fallback string comparison
            l_str = str(left_val or "")
            r_str = str(right_expr)
            if op in ("==", "="):
                return l_str.lower() == r_str.lower()
            elif op in ("!=",):
                return l_str.lower() != r_str.lower()
            elif op == ">":
                return l_str > r_str
            elif op == "<":
                return l_str < r_str
    
    # Default truthy evaluation on resolved field if simple variable name
    val = resolve_json_path(c if c.startswith("$.") else f"$.{c}", scope)
    return bool(val)


class WorkflowInterpreter:
    """Walks workflow steps step-by-step with variable scoping, virtual clock, and branching."""

    def __init__(self, connector: ConnectorLayer):
        self.connector = connector
        self.scope: Dict[str, Any] = {}
        self.virtual_clock_ms: int = 0
        self.trace: List[Dict[str, Any]] = []

    def run(self, workflow: Dict[str, Any], initial_data: Dict[str, Any], failure_step_id: str = None) -> Dict[str, Any]:
        self.scope = {"trigger": initial_data, "env": {}, "globals": {}}
        self.scope.update(initial_data)
        self.virtual_clock_ms = 0
        self.trace = []

        steps = workflow.get("steps") or []
        business_rules = workflow.get("business_rules") or []
        
        reached_terminal = False
        error_encountered = False
        failure_reason = ""

        # Normalize steps
        step_idx = 0
        while step_idx < len(steps):
            step = steps[step_idx]
            step_id = str(step.get("id") or f"step_{step_idx + 1}")
            step_name = step.get("name") or f"Step {step_idx + 1}"
            step_desc = step.get("description") or ""
            step_type = step.get("type", "action")
            operation_id = step.get("operation_id") or step.get("operation")

            # Check if this step is a wait step
            wait_ms = step.get("wait_ms") or parse_wait_duration_ms(f"{step_name} {step_desc}")
            if wait_ms > 0:
                self.virtual_clock_ms += wait_ms

            # Match operation from catalog if not explicitly set
            if not operation_id:
                # Heuristic mapping for standard names
                low_name = step_name.lower()
                if "slack" in low_name:
                    operation_id = "slack.post"
                elif "email" in low_name or "gmail" in low_name:
                    operation_id = "gmail.send"
                elif "sheet" in low_name and "read" in low_name:
                    operation_id = "sheets.read"
                elif "sheet" in low_name:
                    operation_id = "sheets.append_row"
                elif "hubspot" in low_name and "lookup" in low_name:
                    operation_id = "hubspot.lookup_contact"
                elif "hubspot" in low_name and "owner" in low_name:
                    operation_id = "hubspot.assign_owner"
                elif "hubspot" in low_name:
                    operation_id = "hubspot.update_contact"
                elif "refund" in low_name or "stripe" in low_name:
                    operation_id = "stripe.refund"
                elif "delete account" in low_name:
                    operation_id = "account.delete"
                else:
                    operation_id = f"custom.{re.sub(r'[^a-z0-9_]', '_', low_name)}"

            # 1. Condition evaluation if step is condition or has condition logic
            is_condition = step_type == "condition" or "condition" in step
            if is_condition:
                cond_expr = step.get("condition", "")
                branch = evaluate_condition(cond_expr, self.scope)
                branch_taken = "if_true" if branch else "if_false"

                self.trace.append({
                    "step_id": step_id,
                    "step_name": step_name,
                    "type": "condition",
                    "virtual_time_ms": self.virtual_clock_ms,
                    "inputs": {"condition": cond_expr},
                    "output": {"evaluated_to": branch},
                    "branch_taken": branch_taken,
                    "status": "ok",
                })

                # Check jump targets
                jump_to = step.get("if_true") if branch else step.get("if_false")
                if jump_to:
                    # Find matching step index
                    found_idx = next((i for i, s in enumerate(steps) if str(s.get("id")) == str(jump_to) or s.get("name") == jump_to), None)
                    if found_idx is not None:
                        step_idx = found_idx
                        continue

                step_idx += 1
                continue

            # 2. Action Step Execution
            raw_inputs = step.get("inputs") or {}
            resolved_inputs = resolve_inputs(raw_inputs, self.scope)

            # Advance clock for typical action latency
            act_def = catalog.get_action(operation_id)
            latency = act_def.get("avg_latency_ms", 250) if act_def else 250
            self.virtual_clock_ms += latency

            try:
                # Execute via connector layer
                if isinstance(self.connector, MockConnectors):
                    output = self.connector.invoke(operation_id, resolved_inputs, step_id=step_id)
                else:
                    output = self.connector.invoke(operation_id, resolved_inputs)

                # Store output in scope under step_id, step_name, and op_id
                self.scope[step_id] = output
                self.scope[step_name] = output
                self.scope[operation_id] = output

                self.trace.append({
                    "step_id": step_id,
                    "step_name": step_name,
                    "type": "action",
                    "operation_id": operation_id,
                    "virtual_time_ms": self.virtual_clock_ms,
                    "inputs": resolved_inputs,
                    "output": output,
                    "branch_taken": "next",
                    "status": "ok",
                })

            except Exception as exc:
                error_encountered = True
                failure_reason = str(exc)
                self.trace.append({
                    "step_id": step_id,
                    "step_name": step_name,
                    "type": "action",
                    "operation_id": operation_id,
                    "virtual_time_ms": self.virtual_clock_ms,
                    "inputs": resolved_inputs,
                    "output": {"error": failure_reason},
                    "branch_taken": "error_halt",
                    "status": "error",
                })
                break

            step_idx += 1

        # Check if completed all steps
        if not error_encountered and step_idx >= len(steps) and len(steps) > 0:
            reached_terminal = True

        return {
            "reached_terminal": reached_terminal,
            "error_encountered": error_encountered,
            "failure_reason": failure_reason,
            "total_virtual_duration_ms": self.virtual_clock_ms,
            "trace": self.trace,
        }


def extract_condition_scenarios(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Inspect workflow condition steps and business rules to generate targeted test inputs."""
    scenarios_data = []

    steps = workflow.get("steps") or []
    business_rules = workflow.get("business_rules") or []

    extracted_conditions = []
    for s in steps:
        if s.get("type") == "condition" or "condition" in s:
            extracted_conditions.append(s.get("condition", ""))
    for br in business_rules:
        if isinstance(br, dict) and "condition" in br:
            extracted_conditions.append(br["condition"])

    # Base nominal scenario
    scenarios_data.append({"name": "Nominal / Baseline Path", "inputs": {}})

    for cond in extracted_conditions:
        if not cond:
            continue
        c = cond.strip()

        # Numeric comparisons: greater_than X, > X, < X, etc.
        m = re.search(r"([a-zA-Z0-9_\.]+)\s*(>=|<=|>|<|==|=)\s*([0-9,]+)", c)
        if m:
            field = m.group(1).replace("$.", "").split(".")[-1]
            op = m.group(2)
            val = float(m.group(3).replace(",", ""))

            if ">" in op:
                scenarios_data.append({
                    "name": f"Condition ({c}) -> Above Threshold",
                    "inputs": {field: val + 1},
                })
                scenarios_data.append({
                    "name": f"Condition ({c}) -> At Boundary",
                    "inputs": {field: val},
                })
                scenarios_data.append({
                    "name": f"Condition ({c}) -> High Multiplier (10x)",
                    "inputs": {field: val * 10},
                })
                scenarios_data.append({
                    "name": f"Condition ({c}) -> Below Threshold",
                    "inputs": {field: max(0, val - 1)},
                })
            elif "<" in op:
                scenarios_data.append({
                    "name": f"Condition ({c}) -> Below Threshold",
                    "inputs": {field: max(0, val - 1)},
                })
                scenarios_data.append({
                    "name": f"Condition ({c}) -> At Boundary",
                    "inputs": {field: val},
                })
                scenarios_data.append({
                    "name": f"Condition ({c}) -> Above Threshold",
                    "inputs": {field: val + 100},
                })

        # Equals "V"
        m_eq = re.search(r"([a-zA-Z0-9_\.]+)\s*(?:==|=|equals)\s*['\"]([^'\"]+)['\"]", c, re.IGNORECASE)
        if m_eq:
            field = m_eq.group(1).replace("$.", "").split(".")[-1]
            match_val = m_eq.group(2)
            scenarios_data.append({
                "name": f"Condition ({c}) -> Exact Match '{match_val}'",
                "inputs": {field: match_val},
            })
            scenarios_data.append({
                "name": f"Condition ({c}) -> Mismatch 'other_value'",
                "inputs": {field: f"other_{match_val}"},
            })

        # is_empty
        m_emp = re.search(r"(?:is_empty|empty)\(([a-zA-Z0-9_\.]+)\)", c, re.IGNORECASE)
        if m_emp:
            field = m_emp.group(1).replace("$.", "").split(".")[-1]
            scenarios_data.append({
                "name": f"Condition ({c}) -> Empty Value",
                "inputs": {field: ""},
            })
            scenarios_data.append({
                "name": f"Condition ({c}) -> Non-Empty Value",
                "inputs": {field: "filled_value"},
            })

        # in [a, b, c]
        m_in = re.search(r"([a-zA-Z0-9_\.]+)\s+in\s+\[(.*?)\]", c, re.IGNORECASE)
        if m_in:
            field = m_in.group(1).replace("$.", "").split(".")[-1]
            candidates = [it.strip().strip("'\"") for it in m_in.group(2).split(",") if it.strip()]
            for cand in candidates:
                scenarios_data.append({
                    "name": f"Condition ({c}) -> Member '{cand}'",
                    "inputs": {field: cand},
                })
            scenarios_data.append({
                "name": f"Condition ({c}) -> Outside Member 'unknown_option'",
                "inputs": {field: "unknown_option"},
            })

    return scenarios_data


def run_simulation(workflow: Dict[str, Any], max_scenarios: Optional[int] = None) -> Dict[str, Any]:
    """Run deterministic multi-scenario simulation on workflow."""
    steps = workflow.get("steps") or []
    workflow_id = workflow.get("id", 0)

    condition_scenarios = extract_condition_scenarios(workflow)
    
    # Failure scenarios for action steps
    action_steps = [s for s in steps if s.get("type", "action") != "condition"]
    failure_scenarios = []
    for s in action_steps:
        sid = str(s.get("id") or s.get("name"))
        sname = s.get("name", sid)
        failure_scenarios.append({
            "name": f"Fault Injection: Fail at '{sname}'",
            "inputs": {},
            "failure_step_id": sid,
        })

    all_scenario_defs = []
    for sc in condition_scenarios:
        all_scenario_defs.append({
            "name": sc["name"],
            "inputs": sc["inputs"],
            "failure_step_id": None,
        })
    for fsc in failure_scenarios:
        all_scenario_defs.append(fsc)

    # If max_scenarios is provided (from SVS tier), cap or expand with seeded random scenarios
    if max_scenarios:
        if len(all_scenario_defs) > max_scenarios:
            all_scenario_defs = all_scenario_defs[:max_scenarios]
        elif len(all_scenario_defs) < max_scenarios:
            # Generate additional seeded variations
            for i in range(len(all_scenario_defs), max_scenarios):
                all_scenario_defs.append({
                    "name": f"Randomized Scenario #{i + 1}",
                    "inputs": {},
                    "failure_step_id": None,
                })

    scenario_reports = []
    terminated_early_scenarios = []
    success_count = 0
    failure_count = 0
    total_duration_ms = 0

    for idx, sc_def in enumerate(all_scenario_defs):
        seed = 42 + idx
        fake = Faker()
        fake.seed_instance(seed)

        # Build initial trigger mock data
        initial_data = {
            "id": fake.random_int(min=1000, max=9999),
            "amount": fake.random_int(min=1000, max=100000),
            "email": fake.email(),
            "name": fake.name(),
            "company": {"employees": fake.random_int(min=5, max=5000), "name": fake.company()},
        }
        # Merge scenario specific inputs
        initial_data.update(sc_def.get("inputs", {}))

        # Setup mock connector with seeded fake generator
        def fake_data_gen(op_id):
            return generate_action_output(op_id, fake)

        mock_conn = MockConnectors(
            data_generator=fake_data_gen,
            failure_step_id=sc_def.get("failure_step_id"),
        )

        interpreter = WorkflowInterpreter(connector=mock_conn)
        result = interpreter.run(
            workflow=workflow,
            initial_data=initial_data,
            failure_step_id=sc_def.get("failure_step_id"),
        )

        total_duration_ms += result["total_virtual_duration_ms"]
        
        sc_report = {
            "scenario_index": idx + 1,
            "scenario_name": sc_def["name"],
            "inputs": initial_data,
            "reached_terminal": result["reached_terminal"],
            "error_encountered": result["error_encountered"],
            "failure_reason": result["failure_reason"],
            "virtual_duration_ms": result["total_virtual_duration_ms"],
            "step_count": len(result["trace"]),
            "trace": result["trace"],
        }
        scenario_reports.append(sc_report)

        if result["reached_terminal"] and not result["error_encountered"]:
            success_count += 1
        else:
            failure_count += 1
            terminated_early_scenarios.append({
                "scenario_index": idx + 1,
                "scenario_name": sc_def["name"],
                "reason": result["failure_reason"] or "Terminated without reaching final step",
            })

    report = {
        "workflow_id": workflow_id,
        "workflow_name": workflow.get("name", "Workflow"),
        "scenarios_run": len(scenario_reports),
        "outcomes": {
            "success": success_count,
            "failed_or_terminated_early": failure_count,
            "success_rate_percent": round((success_count / len(scenario_reports) * 100), 1) if scenario_reports else 0,
        },
        "terminated_early": terminated_early_scenarios,
        "total_virtual_duration_ms": total_duration_ms,
        "scenarios": scenario_reports,
    }

    if workflow_id:
        LAST_SIMULATION_REPORTS[int(workflow_id)] = report

    return report


def get_last_simulation_report(workflow_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve last stored simulation report for a workflow."""
    return LAST_SIMULATION_REPORTS.get(int(workflow_id))
