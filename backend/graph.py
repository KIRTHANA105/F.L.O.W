"""Workflow Dependency Graph ("Workflow X-Ray") Engine.

Pure Python graph computation:
- Computes field-level writes/listens dependency edges across stored workflows
- Detects cyclic loops using networkx.simple_cycles
- Assigns severity (1-10), SVS tiers (SHALLOW, STANDARD, DEEP), and health
- Supports 1-hop neighborhood query (?workflow_id=X)
- Provides in-memory caching with invalidation
"""

from typing import Any, Dict, List, Optional, Set, Tuple
import networkx as nx

import catalog
import conflict_detector
import db

# In-memory graph cache
_GRAPH_CACHE: Optional[Dict[str, Any]] = None


def invalidate_graph_cache() -> None:
    """Clear cached graph when workflows are added, edited, or deleted."""
    global _GRAPH_CACHE
    _GRAPH_CACHE = None


def _infer_workflow_io(wf: Dict[str, Any]) -> Tuple[str, List[str], List[str], int]:
    """Infer (trigger_label, listens_fields, writes_fields, max_damage) for a workflow."""
    steps = wf.get("steps", [])
    trigger_step = steps[0] if steps else {}
    trigger_label = trigger_step.get("name", "Event Trigger")

    trigger_id, listens = conflict_detector.get_workflow_trigger_info(wf)
    writes, _ = conflict_detector.get_workflow_writes(wf)

    cat_t = catalog.get_trigger(trigger_id)
    if cat_t:
        trigger_label = cat_t["label"]

    max_damage = 1
    for step in steps[1:]:
        op_id = step.get("operation_id")
        if op_id:
            act = catalog.get_action(op_id)
            if act:
                max_damage = max(max_damage, act.get("damage", 1))

    return trigger_label, listens, writes, max_damage


def _compute_tier(step_count: int, max_damage: int) -> str:
    """Compute SVS tier: SHALLOW | STANDARD | DEEP."""
    if max_damage >= 8 or step_count >= 5:
        return "DEEP"
    if max_damage >= 4 or step_count >= 3:
        return "STANDARD"
    return "SHALLOW"


def build_dependency_graph(focused_workflow_id: Optional[int] = None) -> Dict[str, Any]:
    """Compute full dependency graph, cycles, and stats over all stored workflows."""
    global _GRAPH_CACHE

    if _GRAPH_CACHE is not None and focused_workflow_id is None:
        return _GRAPH_CACHE

    all_workflows = db.list_workflows(include_proposed=True)
    dep_map = db.dependency_map()

    # Step 1: Compute node metadata for each workflow
    wf_nodes: Dict[str, Dict[str, Any]] = {}
    for wf in all_workflows:
        wf_id_str = f"wf_{wf['id']}"
        steps = wf.get("steps", [])
        trigger_label, listens, writes, max_damage = _infer_workflow_io(wf)
        tier = _compute_tier(len(steps), max_damage)
        status = "draft" if wf.get("is_proposed") or wf.get("status") == "proposed" else "active"

        wf_nodes[wf_id_str] = {
            "id": wf_id_str,
            "numeric_id": wf["id"],
            "name": wf["name"],
            "department": wf["department"],
            "description": wf.get("description", ""),
            "trigger_label": trigger_label,
            "step_count": len(steps),
            "status": status,
            "severity": max_damage,
            "tier": tier,
            "health": "ok",
            "in_cycle": False,
            "listens": listens,
            "writes": writes,
        }

    # Step 2: Compute edges
    edges: List[Dict[str, Any]] = []
    seen_edge_keys: Set[Tuple[str, str, str]] = set()

    G = nx.DiGraph()
    for node_id, n in wf_nodes.items():
        if n["status"] == "active":
            G.add_node(node_id)

    # 2a. Add explicit database dependencies
    for wf_id, targets in dep_map["outgoing"].items():
        src_id = f"wf_{wf_id}"
        if src_id not in wf_nodes:
            continue
        for target in targets:
            tgt_id = f"wf_{target['workflow_id']}"
            if tgt_id not in wf_nodes:
                continue

            src_writes = wf_nodes[src_id]["writes"]
            tgt_listens = wf_nodes[tgt_id]["listens"]
            shared = [w for w in src_writes if any(catalog.paths_overlap(w, l) for l in tgt_listens)]
            if not shared:
                shared = [target.get("label") or "process.handoff"]

            edge_key = (src_id, tgt_id, "trigger")
            if edge_key not in seen_edge_keys and src_id != tgt_id:
                seen_edge_keys.add(edge_key)
                edges.append({
                    "id": f"e_{src_id}_{tgt_id}_trigger",
                    "source": src_id,
                    "target": tgt_id,
                    "type": "trigger",
                    "fields": shared,
                    "severity": "medium",
                    "in_cycle": False,
                })
                if wf_nodes[src_id]["status"] == "active" and wf_nodes[tgt_id]["status"] == "active":
                    G.add_edge(src_id, tgt_id, fields=shared)

    # 2b. Compute field-level writes -> listens triggers & overlap collisions (active only)
    active_nodes = [n for n in wf_nodes.values() if n["status"] == "active"]
    for i, a in enumerate(active_nodes):
        for j, b in enumerate(active_nodes):
            a_id, b_id = a["id"], b["id"]

            # Trigger dependency: A writes something B listens for
            a_writes = a["writes"]
            b_listens = b["listens"]
            matching_triggers = [w for w in a_writes if any(catalog.paths_overlap(w, l) for l in b_listens)]
            
            if matching_triggers:
                edge_key = (a_id, b_id, "trigger")
                if edge_key not in seen_edge_keys:
                    seen_edge_keys.add(edge_key)
                    edges.append({
                        "id": f"e_{a_id}_{b_id}_trigger",
                        "source": a_id,
                        "target": b_id,
                        "type": "trigger",
                        "fields": matching_triggers,
                        "severity": "medium",
                        "in_cycle": False,
                    })
                    G.add_edge(a_id, b_id, fields=matching_triggers)

            # Overlap collision: shared trigger + shared writes
            if i < j:
                a_listens = a["listens"]
                shared_triggers = [la for la in a_listens if any(catalog.paths_overlap(la, lb) for lb in b_listens)]
                b_writes = b["writes"]
                shared_writes = [wa for wa in a_writes if any(catalog.paths_overlap(wa, wb) for wb in b_writes)]

                if shared_triggers and shared_writes:
                    edge_key = (a_id, b_id, "overlap")
                    if edge_key not in seen_edge_keys:
                        seen_edge_keys.add(edge_key)
                        edges.append({
                            "id": f"e_{a_id}_{b_id}_overlap",
                            "source": a_id,
                            "target": b_id,
                            "type": "overlap",
                            "fields": sorted(list(set(shared_writes))),
                            "severity": "medium",
                            "in_cycle": False,
                        })

    # Step 3: Compute cycles with networkx.simple_cycles
    raw_cycles = list(nx.simple_cycles(G))
    formatted_cycles: List[Dict[str, Any]] = []
    cycle_nodes: Set[str] = set()
    cycle_edges: Set[Tuple[str, str]] = set()

    for cycle in raw_cycles:
        cycle_path = cycle + [cycle[0]]
        last_u, last_v = cycle[-1], cycle[0]
        closing_field = "process.dependency"
        if G.has_edge(last_u, last_v):
            closing_field = G[last_u][last_v].get("fields", ["process.dependency"])[0]

        formatted_cycles.append({
            "path": cycle_path,
            "path_names": [wf_nodes[n]["name"] for n in cycle_path if n in wf_nodes],
            "closing_field": closing_field,
        })

        for n in cycle:
            cycle_nodes.add(n)
        for u, v in zip(cycle_path[:-1], cycle_path[1:]):
            cycle_edges.add((u, v))

    # Step 4: Update node health and edge severity for cycles and overlaps
    overlap_count = 0
    connected_nodes: Set[str] = set()

    for edge in edges:
        connected_nodes.add(edge["source"])
        connected_nodes.add(edge["target"])

        if edge["type"] == "overlap":
            overlap_count += 1
            if edge["source"] in wf_nodes and wf_nodes[edge["source"]]["health"] != "critical":
                wf_nodes[edge["source"]]["health"] = "warning"
            if edge["target"] in wf_nodes and wf_nodes[edge["target"]]["health"] != "critical":
                wf_nodes[edge["target"]]["health"] = "warning"

        if (edge["source"], edge["target"]) in cycle_edges:
            edge["in_cycle"] = True
            edge["severity"] = "high"

    for node_id in cycle_nodes:
        if node_id in wf_nodes:
            wf_nodes[node_id]["in_cycle"] = True
            wf_nodes[node_id]["health"] = "critical"

    # Step 5: Compute stats
    total_nodes = len(wf_nodes)
    num_active = len(active_nodes)
    isolated_nodes = sum(1 for nid in wf_nodes if nid not in connected_nodes)

    stats = {
        "total": total_nodes,
        "active": num_active,
        "cycles": len(formatted_cycles),
        "overlaps": overlap_count,
        "isolated": isolated_nodes,
    }

    nodes_list = list(wf_nodes.values())

    # Step 6: Handle 1-hop focused view if requested
    if focused_workflow_id is not None:
        focus_id = f"wf_{focused_workflow_id}"
        if focus_id in wf_nodes:
            neighbor_ids = {focus_id}
            for e in edges:
                if e["source"] == focus_id:
                    neighbor_ids.add(e["target"])
                elif e["target"] == focus_id:
                    neighbor_ids.add(e["source"])

            nodes_list = [n for n in nodes_list if n["id"] in neighbor_ids]
            edges = [e for e in edges if e["source"] in neighbor_ids and e["target"] in neighbor_ids]

    result = {
        "nodes": nodes_list,
        "edges": edges,
        "cycles": formatted_cycles,
        "stats": stats,
    }

    if focused_workflow_id is None:
        _GRAPH_CACHE = result

    return result
