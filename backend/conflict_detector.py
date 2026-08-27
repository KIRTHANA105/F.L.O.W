"""Field-Level Conflict Detection Engine for FLOW Workflows.

Deterministic pure-Python reasoning:
- Trigger Loops (networkx.simple_cycles over field-level writes -> listens edges)
- Write Collisions (shared trigger + field-level writes overlap)
- Unreachable Paths (contradictory intervals on the same field along a workflow path)

Exclusions:
- status != 'active' (drafts/proposed are excluded from cross-workflow conflict checks)
- Never compare a workflow against itself for write collision
- Operations with side_effect == 'read' contribute nothing to writes
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple
import networkx as nx

import catalog


def get_workflow_trigger_info(wf: Dict[str, Any]) -> Tuple[str, List[str]]:
    """Return (trigger_id, listens_paths) for a workflow."""
    steps = wf.get("steps", [])
    trigger_step = steps[0] if steps else {}
    
    trigger_id = wf.get("trigger_id") or trigger_step.get("trigger_id") or trigger_step.get("operation_id") or ""
    listens: Set[str] = set()

    if "listens" in trigger_step and isinstance(trigger_step["listens"], list):
        listens.update(trigger_step["listens"])
    if "listens" in wf and isinstance(wf["listens"], list):
        listens.update(wf["listens"])

    cat_t = catalog.get_trigger(trigger_id) if trigger_id else None
    if not cat_t:
        t_name = (trigger_step.get("name") or wf.get("name", "")).lower()
        for t in catalog.TRIGGERS:
            if t["trigger_id"].lower() == trigger_id.lower() or t["label"].lower() in t_name:
                cat_t = t
                trigger_id = t["trigger_id"]
                break

    if cat_t:
        trigger_id = cat_t["trigger_id"]
        listens.update(cat_t.get("listens", []))

    return trigger_id, sorted(list(listens))


def get_workflow_writes(wf: Dict[str, Any]) -> Tuple[List[str], Dict[str, List[str]]]:
    """Return (all_writes_paths, step_writes_map) for a workflow."""
    steps = wf.get("steps", [])
    action_steps = steps[1:] if len(steps) > 1 else steps
    
    all_writes: Set[str] = set()
    step_writes_map: Dict[str, List[str]] = {}

    for idx, step in enumerate(action_steps, start=1):
        step_id = step.get("id") or f"s{idx}"
        side_effect = step.get("side_effect")
        op_id = step.get("operation_id") or ""
        
        cat_a = catalog.get_action(op_id) if op_id else None
        if not cat_a:
            s_name = (step.get("name", "") + " " + step.get("description", "")).lower()
            for a in catalog.ACTIONS:
                if a["operation_id"].lower() in s_name or a["label"].lower() in s_name:
                    cat_a = a
                    break

        if cat_a:
            if side_effect is None:
                side_effect = cat_a.get("side_effect", "write")
            if side_effect != "read":
                writes = step.get("writes") or cat_a.get("writes", [])
                all_writes.update(writes)
                step_writes_map[step_id] = list(writes)
        else:
            if side_effect != "read" and "writes" in step:
                writes = step.get("writes", [])
                all_writes.update(writes)
                step_writes_map[step_id] = list(writes)

    return sorted(list(all_writes)), step_writes_map


def detect_trigger_loops(active_workflows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Check A: Build directed graph on writes -> listens overlap and find cycles."""
    G = nx.DiGraph()
    wf_by_id: Dict[str, Dict[str, Any]] = {}

    for wf in active_workflows:
        wid = str(wf.get("id"))
        wf_by_id[wid] = wf
        G.add_node(wid)

    # Add edges when writes(A) overlaps listens(B)
    for a in active_workflows:
        a_id = str(a.get("id"))
        a_writes, _ = get_workflow_writes(a)
        
        for b in active_workflows:
            b_id = str(b.get("id"))
            _, b_listens = get_workflow_trigger_info(b)
            
            matching_fields = []
            for w in a_writes:
                for l in b_listens:
                    if catalog.paths_overlap(w, l):
                        matching_fields.append(w)

            if matching_fields:
                G.add_edge(a_id, b_id, fields=sorted(list(set(matching_fields))))

    cycles = list(nx.simple_cycles(G))
    findings = []

    for cycle in cycles:
        cycle_path = cycle + [cycle[0]]
        # Closing field is on edge cycle[-1] -> cycle[0]
        u, v = cycle[-1], cycle[0]
        closing_fields = G[u][v].get("fields", ["field.unknown"])
        closing_field = closing_fields[0]

        cycle_wfs = [wf_by_id[nid] for nid in cycle if nid in wf_by_id]
        if len(cycle_wfs) == 1:
            msg = f"{cycle_wfs[0]['name']} writes {closing_field}, which triggers its own trigger in an infinite loop."
        elif len(cycle_wfs) == 2:
            msg = f"{cycle_wfs[0]['name']} writes {closing_field}, which triggers {cycle_wfs[1]['name']}, which writes it back."
        else:
            cycle_names = " -> ".join(w["name"] for w in cycle_wfs) + f" -> {cycle_wfs[0]['name']}"
            msg = f"Infinite trigger loop detected: {cycle_names} continuously triggers on field '{closing_field}'."

        findings.append({
            "type": "trigger_loop",
            "severity": "high",
            "message": msg,
            "involved_workflows": [{"id": str(w["id"]), "name": w["name"]} for w in cycle_wfs],
            "evidence": {
                "field_paths": [closing_field],
                "cycle_path": cycle_path,
                "step_ids": [s.get("id") or f"s{i}" for w in cycle_wfs for i, s in enumerate(w.get("steps", []))],
            },
        })

    return findings


def detect_write_collisions(active_workflows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Check B: Detect write collisions when workflows share a trigger and write the same field."""
    findings = []
    n = len(active_workflows)

    for i in range(n):
        for j in range(i + 1, n):
            a = active_workflows[i]
            b = active_workflows[j]

            t_a_id, listens_a = get_workflow_trigger_info(a)
            t_b_id, listens_b = get_workflow_trigger_info(b)

            same_trigger = False
            trigger_name = t_a_id or "shared trigger"
            if t_a_id and t_b_id and t_a_id == t_b_id:
                same_trigger = True
            elif listens_a and listens_b:
                for la in listens_a:
                    for lb in listens_b:
                        if catalog.paths_overlap(la, lb):
                            same_trigger = True
                            trigger_name = la
                            break
                    if same_trigger:
                        break

            if not same_trigger:
                continue

            writes_a, step_map_a = get_workflow_writes(a)
            writes_b, step_map_b = get_workflow_writes(b)

            shared_paths = set()
            colliding_steps = []

            for wa in writes_a:
                for wb in writes_b:
                    if catalog.paths_overlap(wa, wb):
                        shared_paths.add(wa if not wa.endswith(".*") else wb)
                        # Add step ids
                        for sid, s_writes in step_map_a.items():
                            if wa in s_writes:
                                colliding_steps.append(sid)
                        for sid, s_writes in step_map_b.items():
                            if wb in s_writes:
                                colliding_steps.append(sid)

            if shared_paths:
                sorted_fields = sorted(list(shared_paths))
                fields_str = ", ".join(sorted_fields)
                findings.append({
                    "type": "write_collision",
                    "severity": "medium",
                    "message": f"Write collision: '{a['name']}' and '{b['name']}' both trigger on '{trigger_name}' and modify shared field(s): {fields_str}.",
                    "involved_workflows": [
                        {"id": str(a["id"]), "name": a["name"]},
                        {"id": str(b["id"]), "name": b["name"]},
                    ],
                    "evidence": {
                        "field_paths": sorted_fields,
                        "cycle_path": [],
                        "step_ids": sorted(list(set(colliding_steps))),
                    },
                })

    return findings


def parse_condition_expr(expr_str: str) -> Optional[Tuple[str, str, Any]]:
    """Parse condition like 'employees > 100' or 'country == \"India\"' into (field, op, val)."""
    if not expr_str or not isinstance(expr_str, str):
        return None
    
    m = re.match(r"^\s*([a-zA-Z0-9_$.]+)\s*(>=|<=|>|<|==|!=|=)\s*(.+?)\s*$", expr_str.strip())
    if not m:
        return None
    
    field = m.group(1).lstrip("$.").strip()
    op = m.group(2)
    if op == "=":
        op = "=="
    raw_val = m.group(3).strip().strip("'\"")
    
    try:
        val = float(raw_val.replace(",", ""))
    except ValueError:
        val = raw_val
        
    return field, op, val


class Interval:
    """Interval domain for a single numeric or categorical field."""
    def __init__(self, field: str):
        self.field = field
        self.min_val = float("-inf")
        self.max_val = float("inf")
        self.min_inclusive = False
        self.max_inclusive = False
        self.exact_val: Optional[Any] = None
        self.excluded_vals: Set[Any] = set()
        self.is_empty = False

    def add_condition(self, op: str, val: Any) -> bool:
        """Apply condition. Returns True if valid, False if contradiction / empty."""
        if self.is_empty:
            return False

        if isinstance(val, (int, float)):
            num_val = float(val)
            if op == ">":
                if num_val >= self.max_val if not self.max_inclusive else num_val > self.max_val:
                    self.is_empty = True
                    return False
                if num_val > self.min_val or (num_val == self.min_val and self.min_inclusive):
                    self.min_val = num_val
                    self.min_inclusive = False
            elif op == ">=":
                if num_val > self.max_val:
                    self.is_empty = True
                    return False
                if num_val > self.min_val:
                    self.min_val = num_val
                    self.min_inclusive = True
            elif op == "<":
                if num_val <= self.min_val if not self.min_inclusive else num_val < self.min_val:
                    self.is_empty = True
                    return False
                if num_val < self.max_val or (num_val == self.max_val and self.max_inclusive):
                    self.max_val = num_val
                    self.max_inclusive = False
            elif op == "<=":
                if num_val < self.min_val:
                    self.is_empty = True
                    return False
                if num_val < self.max_val:
                    self.max_val = num_val
                    self.max_inclusive = True
            elif op == "==":
                if num_val < self.min_val or num_val > self.max_val:
                    self.is_empty = True
                    return False
                if num_val == self.min_val and not self.min_inclusive:
                    self.is_empty = True
                    return False
                if num_val == self.max_val and not self.max_inclusive:
                    self.is_empty = True
                    return False
                if self.exact_val is not None and self.exact_val != num_val:
                    self.is_empty = True
                    return False
                self.exact_val = num_val
                self.min_val = num_val
                self.max_val = num_val
                self.min_inclusive = True
                self.max_inclusive = True
            elif op == "!=":
                self.excluded_vals.add(num_val)
                if self.exact_val == num_val:
                    self.is_empty = True
                    return False

            if self.min_val > self.max_val or (self.min_val == self.max_val and not (self.min_inclusive and self.max_inclusive)):
                self.is_empty = True
                return False
        else:
            str_val = str(val)
            if op == "==":
                if self.exact_val is not None and self.exact_val != str_val:
                    self.is_empty = True
                    return False
                if str_val in self.excluded_vals:
                    self.is_empty = True
                    return False
                self.exact_val = str_val
            elif op == "!=":
                self.excluded_vals.add(str_val)
                if self.exact_val == str_val:
                    self.is_empty = True
                    return False

        return not self.is_empty


def detect_unreachable_paths(workflows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Check C: Detect unreachable execution paths caused by contradictory conditions on the same field."""
    findings = []

    for wf in workflows:
        steps = wf.get("steps", [])
        business_rules = wf.get("business_rules", [])

        # Collect linear step conditions
        cond_entries = []
        for i, step in enumerate(steps):
            step_id = step.get("id") or f"s{i+1}"
            cond_str = step.get("condition") or step.get("condition_expr") or ""
            if cond_str:
                parsed = parse_condition_expr(cond_str)
                if parsed:
                    cond_entries.append((step_id, cond_str, parsed))

        for rule in business_rules:
            cond_str = rule.get("condition") or ""
            if cond_str:
                parsed = parse_condition_expr(cond_str)
                if parsed:
                    cond_entries.append((rule.get("step_id") or "rule", cond_str, parsed))

        # Check conditions along the sequential path
        intervals: Dict[str, Interval] = {}
        history: Dict[str, List[Tuple[str, str]]] = {}

        for step_id, raw_cond, (field, op, val) in cond_entries:
            if field not in intervals:
                intervals[field] = Interval(field)
                history[field] = []

            history[field].append((step_id, raw_cond))
            valid = intervals[field].add_condition(op, val)

            if not valid:
                first_step_id, first_cond = history[field][0]
                findings.append({
                    "type": "unreachable_path",
                    "severity": "medium",
                    "message": f"Unreachable execution path in '{wf.get('name', 'Workflow')}': contradictory conditions on field '{field}' ('{first_cond}' and '{raw_cond}').",
                    "involved_workflows": [{"id": str(wf.get("id")), "name": wf.get("name", "Workflow")}],
                    "evidence": {
                        "field_paths": [field],
                        "cycle_path": [],
                        "step_ids": [first_step_id, step_id],
                    },
                })
                break

    return findings


def detect_all_conflicts(workflows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Run all three conflict checks on active workflows."""
    active_wfs = [w for w in workflows if w.get("status") == "active" and not w.get("is_proposed")]
    
    findings = []
    findings.extend(detect_trigger_loops(active_wfs))
    findings.extend(detect_write_collisions(active_wfs))
    findings.extend(detect_unreachable_paths(active_wfs))
    
    return findings
