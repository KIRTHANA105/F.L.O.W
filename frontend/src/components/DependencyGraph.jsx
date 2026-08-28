import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { api } from "../api";
import { DepartmentBadge, Spinner, ErrorNote } from "./Shared";

const NODE_WIDTH = 190;
const NODE_HEIGHT = 74;

// ─── Custom Node Component ──────────────────────────────────────────────────
function WorkflowGraphNode({ data }) {
  const {
    name,
    trigger_label,
    severity = 1,
    tier = "SHALLOW",
    health = "ok",
    in_cycle = false,
    status = "active",
    isDimmed = false,
    isHighlighted = false,
  } = data;

  // Severity bar color: green 1-3, amber 4-7, red 8-10
  const severityColor =
    severity >= 8 ? "#ef4444" : severity >= 4 ? "#f59e0b" : "#10b981";

  // Tier abbreviation: S / ST / D
  const tierShort =
    tier === "DEEP" ? "D" : tier === "STANDARD" ? "ST" : "S";

  // Border class
  const borderClass = in_cycle
    ? "node-border-cycle"
    : health === "warning"
    ? "node-border-warning"
    : "node-border-default";

  const truncatedName =
    name.length > 22 ? name.substring(0, 21) + "…" : name;

  return (
    <div
      className={`xray-node ${borderClass} ${status === "draft" ? "node-draft" : ""} ${
        isDimmed ? "node-dimmed" : ""
      } ${isHighlighted ? "node-highlighted" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="xray-handle target-handle"
      />

      {/* 4px Severity Bar */}
      <div
        className="xray-severity-bar"
        style={{ backgroundColor: severityColor }}
        title={`Damage Severity: ${severity}/10`}
      />

      <div className="xray-node-content">
        <div className="xray-node-top">
          <span className="xray-node-title" title={name}>
            {truncatedName}
          </span>
          <span className={`xray-tier-badge tier-${tier.toLowerCase()}`} title={`SVS Tier: ${tier}`}>
            {tierShort}
          </span>
        </div>

        <div className="xray-node-trigger" title={`Trigger: ${trigger_label}`}>
          ⚡ {trigger_label}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="xray-handle source-handle"
      />
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowGraphNode };

// ─── Dagre Layout Generator ──────────────────────────────────────────────────
function getLayoutedElements(nodes, edges, direction = "LR") {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 35,
    ranksep: 75,
    marginx: 30,
    marginy: 30,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Main Dependency Graph Component ─────────────────────────────────────────
export default function DependencyGraph({ onNavigateToSimulation, triggerAiGlow }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters & State
  const [showDrafts, setShowDrafts] = useState(false);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [cycleHighlightActive, setCycleHighlightActive] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowInstance = useRef(null);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getGraph();
      setGraphData(data);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load workflow dependency graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Compute Active Cycles & Cycle Nodes
  const cycleInfo = useMemo(() => {
    const cycles = graphData?.cycles || [];
    const cycleNodeSet = new Set();
    const cycleEdgeSet = new Set();

    cycles.forEach((c) => {
      const path = c.path || [];
      path.forEach((n) => cycleNodeSet.add(n));
      for (let i = 0; i < path.length - 1; i++) {
        cycleEdgeSet.add(`${path[i]}->${path[i + 1]}`);
      }
    });

    return { cycles, cycleNodeSet, cycleEdgeSet };
  }, [graphData]);

  // Filter & Layout Nodes + Edges
  useEffect(() => {
    if (!graphData) return;

    let rawNodes = graphData.nodes || [];
    let rawEdges = graphData.edges || [];

    // Filter drafts
    if (!showDrafts) {
      const activeNodeIds = new Set(
        rawNodes.filter((n) => n.status !== "draft").map((n) => n.id)
      );
      rawNodes = rawNodes.filter((n) => n.status !== "draft");
      rawEdges = rawEdges.filter(
        (e) => activeNodeIds.has(e.source) && activeNodeIds.has(e.target)
      );
    }

    // Filter only conflicts / cyclic / warning nodes
    if (onlyConflicts) {
      const conflictNodeIds = new Set(
        rawNodes.filter((n) => n.health !== "ok" || n.in_cycle).map((n) => n.id)
      );
      rawNodes = rawNodes.filter((n) => conflictNodeIds.has(n.id));
      rawEdges = rawEdges.filter(
        (e) => conflictNodeIds.has(e.source) && conflictNodeIds.has(e.target)
      );
    }

    // Separate connected nodes from isolated nodes
    const connectedNodeIds = new Set();
    rawEdges.forEach((e) => {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    });

    const mainGraphRawNodes = rawNodes.filter((n) => connectedNodeIds.has(n.id));

    // Determine highlighting state
    const isCycleMode = cycleHighlightActive && cycleInfo.cycles.length > 0;
    const isHoverMode = !!hoveredNodeId;

    // Hovered node's connected neighbors
    const hoverNeighborIds = new Set();
    const hoverEdgeIds = new Set();
    if (isHoverMode) {
      hoverNeighborIds.add(hoveredNodeId);
      rawEdges.forEach((e) => {
        if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
          hoverNeighborIds.add(e.source);
          hoverNeighborIds.add(e.target);
          hoverEdgeIds.add(e.id);
        }
      });
    }

    // Build React Flow nodes
    const rfNodes = mainGraphRawNodes.map((n) => {
      let isDimmed = false;
      let isHighlighted = false;

      if (isCycleMode) {
        if (cycleInfo.cycleNodeSet.has(n.id)) {
          isHighlighted = true;
        } else {
          isDimmed = true;
        }
      } else if (isHoverMode) {
        if (hoverNeighborIds.has(n.id)) {
          isHighlighted = true;
        } else {
          isDimmed = true;
        }
      }

      return {
        id: n.id,
        type: "workflowNode",
        data: {
          ...n,
          isDimmed,
          isHighlighted,
        },
        position: { x: 0, y: 0 },
      };
    });

    // Build React Flow edges
    const rfEdges = rawEdges.map((e) => {
      const isCycleEdge = e.in_cycle || cycleInfo.cycleEdgeSet.has(`${e.source}->${e.target}`);
      const isOverlap = e.type === "overlap";

      let edgeColor = isCycleEdge ? "#ef4444" : isOverlap ? "#f59e0b" : "#6366f1";
      let strokeWidth = isCycleEdge ? 3 : 1.75;
      let strokeDasharray = isOverlap ? "5,5" : undefined;
      let animated = isCycleEdge;

      let isDimmed = false;
      if (isCycleMode) {
        if (!isCycleEdge) isDimmed = true;
      } else if (isHoverMode) {
        if (!hoverEdgeIds.has(e.id)) isDimmed = true;
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: animated && !isDimmed,
        style: {
          stroke: isDimmed ? "rgba(255,255,255,0.08)" : edgeColor,
          strokeWidth,
          strokeDasharray,
          opacity: isDimmed ? 0.2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isDimmed ? "rgba(255,255,255,0.08)" : edgeColor,
        },
        label: (e.fields || []).join(", "),
        labelStyle: {
          fontSize: 10,
          fill: isDimmed ? "rgba(0,0,0,0.15)" : "#334155",
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: isDimmed ? "transparent" : "#ffffff",
          fillOpacity: 0.95,
          rx: 4,
          ry: 4,
        },
      };
    });

    if (rfNodes.length > 0) {
      const layouted = getLayoutedElements(rfNodes, rfEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [
    graphData,
    showDrafts,
    onlyConflicts,
    cycleHighlightActive,
    cycleInfo,
    hoveredNodeId,
    setNodes,
    setEdges,
  ]);

  // Selected Node Details
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graphData) return null;
    return (graphData.nodes || []).find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphData]);

  // Isolated Nodes
  const isolatedNodes = useMemo(() => {
    if (!graphData) return [];
    const connected = new Set();
    (graphData.edges || []).forEach((e) => {
      connected.add(e.source);
      connected.add(e.target);
    });

    let list = (graphData.nodes || []).filter((n) => !connected.has(n.id));
    if (!showDrafts) {
      list = list.filter((n) => n.status !== "draft");
    }
    return list;
  }, [graphData, showDrafts]);

  // Node Click & Hover Handlers
  const handleNodeClick = (_, node) => {
    setSelectedNodeId(node.id);
  };

  const handleNodeMouseEnter = (_, node) => {
    setHoveredNodeId(node.id);
  };

  const handleNodeMouseLeave = () => {
    setHoveredNodeId(null);
  };

  const handleFitView = () => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2, duration: 400 });
    }
  };

  const handleResetZoom = () => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.setViewport({ x: 50, y: 50, zoom: 1 }, { duration: 300 });
    }
  };

  // Navigate to simulation tab
  const handleSimulate = (numericId) => {
    if (onNavigateToSimulation && numericId) {
      onNavigateToSimulation(numericId);
    }
  };

  const stats = graphData?.stats || { total: 0, active: 0, cycles: 0, overlaps: 0, isolated: 0 };
  const firstCycle = cycleInfo.cycles[0] || null;

  return (
    <div className="xray-container">
      {/* Top Header & Stats */}
      <div className="xray-header">
        <div>
          <div className="xray-badge">
            <span className="xray-pulse-dot" /> WORKFLOW X-RAY & DEPENDENCY GRAPH
          </div>
          <h1>Workflow Dependency Graph</h1>
          <p>
            Pure graph intelligence visualising inter-workflow triggers, state collisions,
            and infinite execution loops.
          </p>
        </div>

        <div className="xray-stats-bar">
          <div className="xray-stat-card">
            <span className="xray-stat-num">{stats.total}</span>
            <span className="xray-stat-lbl">Total Workflows</span>
          </div>
          <div className="xray-stat-card">
            <span className={`xray-stat-num ${stats.cycles > 0 ? "stat-danger" : "stat-ok"}`}>
              {stats.cycles}
            </span>
            <span className="xray-stat-lbl">Infinite Loops</span>
          </div>
          <div className="xray-stat-card">
            <span className={`xray-stat-num ${stats.overlaps > 0 ? "stat-warn" : "stat-ok"}`}>
              {stats.overlaps}
            </span>
            <span className="xray-stat-lbl">Overlaps</span>
          </div>
          <div className="xray-stat-card">
            <span className="xray-stat-num stat-ok">{stats.isolated}</span>
            <span className="xray-stat-lbl">Independent</span>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />

      {/* Infinite Loop Warning Banner (The Money Shot) */}
      {firstCycle && (
        <div className="cycle-alert-banner">
          <div className="cycle-alert-icon">⚠</div>
          <div className="cycle-alert-content">
            <div className="cycle-alert-title">
              {stats.cycles} infinite loop{stats.cycles > 1 ? "s" : ""} detected
            </div>
            <div className="cycle-alert-path">
              {(firstCycle.path_names || []).join(" → ")}
            </div>
            <div className="cycle-alert-sub">
              These workflows trigger each other in a loop through{" "}
              <code>{firstCycle.closing_field}</code>
            </div>
          </div>
          <button
            className={`btn ${cycleHighlightActive ? "danger" : "secondary"} btn-sm`}
            onClick={() => setCycleHighlightActive(!cycleHighlightActive)}
          >
            {cycleHighlightActive ? "✕ Clear Highlight" : "⚡ Highlight in Graph"}
          </button>
        </div>
      )}

      {/* Toolbar & Filter Controls */}
      <div className="xray-toolbar">
        <div className="xray-toolbar-left">
          <label className="xray-toggle-label">
            <input
              type="checkbox"
              checked={showDrafts}
              onChange={(e) => setShowDrafts(e.target.checked)}
            />
            <span>Show drafts</span>
          </label>

          <label className="xray-toggle-label">
            <input
              type="checkbox"
              checked={onlyConflicts}
              onChange={(e) => setOnlyConflicts(e.target.checked)}
            />
            <span>Only show conflicts</span>
          </label>
        </div>

        <div className="xray-toolbar-right">
          <button className="btn ghost btn-xs" onClick={handleFitView} title="Fit graph to view">
            ⛶ Fit View
          </button>
          <button className="btn ghost btn-xs" onClick={handleResetZoom} title="Reset zoom to 100%">
            1:1 Reset
          </button>
          <button className="btn ghost btn-xs" onClick={loadGraph} title="Reload graph">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Canvas + Side Drawer */}
      <div className="xray-canvas-wrapper">
        <div className="xray-canvas">
          {loading ? (
            <div className="xray-loading">
              <Spinner /> Computing dependency graph…
            </div>
          ) : nodes.length === 0 && isolatedNodes.length === 0 ? (
            <div className="xray-empty">
              <h3>No workflows found</h3>
              <p>Create workflows to map dependencies and detect cycles.</p>
            </div>
          ) : nodes.length === 0 ? (
            <div className="xray-empty">
              <h3>All workflows are independent</h3>
              <p>No trigger collisions or inter-workflow dependencies found.</p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              onInit={(instance) => (reactFlowInstance.current = instance)}
              fitView
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#cbd5e1" gap={18} size={1} />
              <Controls showInteractive={false} className="xray-flow-controls" />
              <MiniMap
                nodeStrokeColor="#6366f1"
                nodeColor="#e2e8f0"
                maskColor="rgba(241, 245, 249, 0.75)"
                className="xray-minimap"
              />
            </ReactFlow>
          )}

          {/* Compact Legend */}
          <div className="xray-legend">
            <div className="legend-title">Graph Legend</div>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-bar sev-green" /> <span>Severity 1-3</span>
              </div>
              <div className="legend-item">
                <span className="legend-bar sev-amber" /> <span>Severity 4-7</span>
              </div>
              <div className="legend-item">
                <span className="legend-bar sev-red" /> <span>Severity 8-10</span>
              </div>
              <div className="legend-item">
                <span className="legend-line line-solid" /> <span>Trigger dep</span>
              </div>
              <div className="legend-item">
                <span className="legend-line line-dashed" /> <span>State overlap</span>
              </div>
              <div className="legend-item">
                <span className="legend-line line-cycle" /> <span>Infinite cycle</span>
              </div>
            </div>
          </div>
        </div>

        {/* Node Detail Side Panel */}
        {selectedNode && (
          <div className="xray-drawer">
            <div className="xray-drawer-header">
              <div>
                <DepartmentBadge department={selectedNode.department} />
                <h3 className="xray-drawer-title">{selectedNode.name}</h3>
              </div>
              <button
                className="modal-close"
                onClick={() => setSelectedNodeId(null)}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>

            <div className="xray-drawer-body">
              <div className="drawer-metric-grid">
                <div className="drawer-metric-card">
                  <span className="drawer-metric-lbl">SVS Tier</span>
                  <span className="drawer-metric-val">{selectedNode.tier}</span>
                </div>
                <div className="drawer-metric-card">
                  <span className="drawer-metric-lbl">Max Severity</span>
                  <span
                    className={`drawer-metric-val ${
                      selectedNode.severity >= 8
                        ? "stat-danger"
                        : selectedNode.severity >= 4
                        ? "stat-warn"
                        : "stat-ok"
                    }`}
                  >
                    {selectedNode.severity}/10
                  </span>
                </div>
                <div className="drawer-metric-card">
                  <span className="drawer-metric-lbl">Health</span>
                  <span
                    className={`drawer-metric-val ${
                      selectedNode.in_cycle
                        ? "stat-danger"
                        : selectedNode.health === "warning"
                        ? "stat-warn"
                        : "stat-ok"
                    }`}
                  >
                    {selectedNode.in_cycle
                      ? "CYCLE"
                      : selectedNode.health.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Writes Section */}
              <div className="drawer-section">
                <div className="drawer-section-lbl">
                  <span>Writes to State</span>
                  <span className="drawer-count">{(selectedNode.writes || []).length}</span>
                </div>
                <div className="drawer-tags">
                  {(selectedNode.writes || []).length === 0 ? (
                    <span className="drawer-empty-tag">None (Read-only)</span>
                  ) : (
                    selectedNode.writes.map((w, i) => (
                      <span key={i} className="field-pill field-write">
                        {w}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Listens Section */}
              <div className="drawer-section">
                <div className="drawer-section-lbl">
                  <span>Listens for Triggers</span>
                  <span className="drawer-count">{(selectedNode.listens || []).length}</span>
                </div>
                <div className="drawer-tags">
                  {(selectedNode.listens || []).length === 0 ? (
                    <span className="drawer-empty-tag">Scheduled / Unbound</span>
                  ) : (
                    selectedNode.listens.map((l, i) => (
                      <span key={i} className="field-pill field-listen">
                        {l}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Step Sequence Summary */}
              <div className="drawer-section">
                <div className="drawer-section-lbl">
                  <span>Process Steps</span>
                  <span className="drawer-count">{selectedNode.step_count}</span>
                </div>
                <div className="drawer-desc">{selectedNode.description}</div>
              </div>

              {/* Simulate this Action */}
              <div className="drawer-actions">
                <button
                  className="btn primary btn-sm w-full"
                  onClick={() => handleSimulate(selectedNode.numeric_id)}
                >
                  ⚡ Simulate This Workflow
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Independent Workflows Shelf (Bottom Container) */}
      {isolatedNodes.length > 0 && !onlyConflicts && (
        <div className="xray-shelf">
          <div className="xray-shelf-header">
            <h4>Independent Workflows</h4>
            <span className="xray-shelf-sub">
              {isolatedNodes.length} healthy workflow{isolatedNodes.length !== 1 ? "s" : ""} running
              with zero cross-process dependencies or collision risks
            </span>
          </div>

          <div className="xray-shelf-grid">
            {isolatedNodes.map((node) => (
              <div
                key={node.id}
                className="xray-shelf-card"
                onClick={() => setSelectedNodeId(node.id)}
              >
                <div className="shelf-card-top">
                  <DepartmentBadge department={node.department} />
                  <span className="shelf-tier">{node.tier}</span>
                </div>
                <div className="shelf-card-title">{node.name}</div>
                <div className="shelf-card-trigger">⚡ {node.trigger_label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
