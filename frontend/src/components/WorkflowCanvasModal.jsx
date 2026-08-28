import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { api } from "../api";
import { DepartmentBadge, Spinner } from "./Shared";

// ─── Error Boundary ──────────────────────────────────────────────────────────
class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Canvas rendering error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", textAlign: "center", background: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca", margin: "16px" }}>
          <h4 style={{ color: "#991b1b", margin: "0 0 8px 0" }}>Canvas View Unavailable</h4>
          <p style={{ color: "#7f1d1d", fontSize: "13px", margin: "0 0 12px 0" }}>
            {this.state.error?.message || "An error occurred while laying out the workflow nodes."}
          </p>
          <button className="btn secondary btn-sm" onClick={() => this.setState({ hasError: false })}>
            Retry Rendering
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── App Icon / Initials Mapping ─────────────────────────────────────────────
function getAppMeta(opId = "", name = "") {
  const text = `${opId} ${name}`.toLowerCase();
  if (text.includes("hubspot")) return { app: "HubSpot", initial: "HS", color: "#ff7a59" };
  if (text.includes("stripe")) return { app: "Stripe", initial: "ST", color: "#635bff" };
  if (text.includes("slack")) return { app: "Slack", initial: "SL", color: "#4a154b" };
  if (text.includes("sheets") || text.includes("google")) return { app: "Sheets", initial: "GS", color: "#0f9d58" };
  if (text.includes("gmail") || text.includes("email") || text.includes("mail")) return { app: "Gmail", initial: "GM", color: "#ea4335" };
  if (text.includes("form") || text.includes("webhook")) return { app: "Webhook", initial: "WH", color: "#6366f1" };
  if (text.includes("schedule") || text.includes("cron")) return { app: "Clock", initial: "CR", color: "#8b5cf6" };
  if (text.includes("jira")) return { app: "Jira", initial: "JR", color: "#0052cc" };
  if (text.includes("salesforce")) return { app: "Salesforce", initial: "SF", color: "#00a1e0" };
  if (text.includes("database") || text.includes("sql")) return { app: "Database", initial: "DB", color: "#0ea5e9" };
  return { app: "FLOW", initial: "FL", color: "#64748b" };
}

// ─── Custom Step Node Component ──────────────────────────────────────────────
function StepNode({ data, selected }) {
  const {
    label = "Step",
    app = "App",
    initial = "ST",
    appColor = "#64748b",
    type = "action",
    sideEffect = "write",
    damage = 1,
    hasErrorHandling = false,
    isUndefined = false,
    executionState = "idle", // "executed" | "failed" | "idle"
    isDimmed = false,
  } = data || {};

  const isTrigger = type === "trigger";
  const isCondition = type === "condition";
  const isWait = type === "wait";
  const isApproval = type === "human_approval";
  const isEnd = type === "end";

  const typeColor = isTrigger
    ? "#10b981"
    : isCondition
    ? "#f59e0b"
    : isWait
    ? "#64748b"
    : isApproval
    ? "#8b5cf6"
    : isEnd
    ? "#94a3b8"
    : isUndefined
    ? "#ef4444"
    : "#3b82f6";

  const isIrreversible = sideEffect === "irreversible" || damage === 10;
  const isHighDamage = damage >= 7;

  let animBorder = "1px solid #e2e8f0";
  if (executionState === "executed") animBorder = "2px solid #10b981";
  if (executionState === "failed") animBorder = "2px solid #ef4444";
  if (selected) animBorder = "2px solid #6366f1";
  if (isUndefined) animBorder = "2px solid #ef4444";

  if (isEnd) {
    return (
      <div
        style={{
          width: "120px",
          height: "44px",
          borderRadius: "8px",
          background: "#ffffff",
          border: animBorder,
          borderLeft: `4px solid ${typeColor}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          opacity: isDimmed ? 0.25 : 1,
          transition: "all 0.2s ease",
        }}
      >
        <Handle type="target" position={Position.Left} style={{ background: "#94a3b8", width: 6, height: 6 }} />
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
          🏁 END
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "210px",
        height: "72px",
        borderRadius: isTrigger ? "16px 8px 8px 16px" : "8px",
        background: isUndefined ? "#fef2f2" : "#ffffff",
        border: animBorder,
        borderLeft: `4px solid ${typeColor}`,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: "10px",
        position: "relative",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        opacity: isDimmed ? 0.25 : 1,
        transition: "all 0.25s ease",
        cursor: "pointer",
      }}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#64748b", width: 7, height: 7, border: "2px solid #ffffff" }}
        />
      )}

      {isCondition ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "30%", background: "#10b981", width: 7, height: 7, border: "2px solid #ffffff" }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "70%", background: "#ef4444", width: 7, height: 7, border: "2px solid #ffffff" }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: "#64748b", width: 7, height: 7, border: "2px solid #ffffff" }}
        />
      )}

      <div
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "6px",
          background: appColor,
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transform: isCondition ? "rotate(45deg)" : "none",
        }}
      >
        <span style={{ transform: isCondition ? "rotate(-45deg)" : "none" }}>
          {isCondition ? "?" : initial}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
        <span
          title={label}
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: isUndefined ? "#ef4444" : "#0f172a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: "11px", color: "#64748b", textTransform: "capitalize" }}>
          {isTrigger ? "⚡ Trigger Event" : isCondition ? "Decision Gate" : app}
        </span>
      </div>

      <div style={{ position: "absolute", top: "6px", right: "6px", display: "flex", gap: "4px", alignItems: "center" }}>
        {isIrreversible && (
          <span
            title="Cannot be undone (Irreversible Action)"
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#ef4444",
              display: "inline-block",
              boxShadow: "0 0 4px rgba(239, 68, 68, 0.6)",
            }}
          />
        )}
        {!isIrreversible && isHighDamage && (
          <span
            title={`High Impact Damage (${damage}/10)`}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#f59e0b",
              display: "inline-block",
            }}
          />
        )}
        {!isTrigger && !isCondition && !isEnd && !hasErrorHandling && (
          <span
            title="No error handling configured"
            style={{ fontSize: "11px", color: "#d97706", fontWeight: "bold" }}
          >
            ⚠
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  step: StepNode,
};

// ─── Dagre Automatic Layout ──────────────────────────────────────────────────
function getLayoutedElements(nodes, edges, direction = "LR") {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 90 });

  (nodes || []).forEach((node) => {
    const isEnd = node.data?.type === "end";
    dagreGraph.setNode(node.id, { width: isEnd ? 120 : 210, height: isEnd ? 44 : 72 });
  });

  (edges || []).forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = (nodes || []).map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id) || { x: 100, y: 100 };
    const isEnd = node.data?.type === "end";
    const w = isEnd ? 120 : 210;
    const h = isEnd ? 44 : 72;
    return {
      ...node,
      position: {
        x: (nodeWithPosition.x || 100) - w / 2,
        y: (nodeWithPosition.y || 100) - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges: edges || [] };
}

// ─── Inner Canvas Graph Component ────────────────────────────────────────────
function WorkflowCanvasInner({
  workflow,
  onClose,
  catalog,
  simReport,
  onRunSim,
  isEmbedded = false,
}) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [animatingScenario, setAnimatingScenario] = useState(false);
  const [executedStepIds, setExecutedStepIds] = useState(new Set());
  const [failedStepId, setFailedStepId] = useState(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const animTimerRef = useRef(null);

  // 1. Build layout when workflow changes
  useEffect(() => {
    if (!workflow) return;

    const rawSteps = workflow.steps || [];
    const rawNodes = [];
    const rawEdges = [];
    const stepIdMap = new Set();

    rawSteps.forEach((s, idx) => {
      const id = s.id || `s_${idx}`;
      stepIdMap.add(id);
    });

    rawSteps.forEach((s, idx) => {
      const id = s.id || `s_${idx}`;
      const isFirst = idx === 0;
      const stepType = s.type || (isFirst ? "trigger" : s.condition ? "condition" : "action");

      const opId = s.operation_id || s.operation || s.trigger_id || "";
      const catAction = catalog?.actions?.find((a) => a.operation_id === opId);
      const meta = getAppMeta(opId || s.name, s.name);

      const sideEffect = catAction?.side_effect || (s.name.toLowerCase().includes("refund") ? "irreversible" : "write");
      const damage = catAction?.damage || (s.name.toLowerCase().includes("refund") ? 10 : 2);
      const hasErrorHandling = !!(s.error_policy || s.on_error || s.retry_count);

      rawNodes.push({
        id,
        type: "step",
        position: { x: 0, y: 0 },
        data: {
          id,
          rawStep: s,
          label: s.name || `Step ${idx + 1}`,
          app: meta.app,
          initial: meta.initial,
          appColor: meta.color,
          type: stepType,
          operationId: opId,
          sideEffect,
          damage,
          hasErrorHandling,
          condition: s.condition || null,
          inputs: s.inputs || catAction?.inputs || [],
          outputs: s.outputs || catAction?.outputs || [],
          errorPolicy: s.error_policy || s.on_error || null,
        },
      });
    });

    // Edges
    rawSteps.forEach((s, idx) => {
      const currentId = s.id || `s_${idx}`;
      const isCondition = s.type === "condition" || !!s.condition;

      if (isCondition) {
        const trueTarget = s.true_step_id || (idx + 1 < rawSteps.length ? rawSteps[idx + 1].id || `s_${idx + 1}` : "end_node");
        const trueExists = stepIdMap.has(trueTarget) || trueTarget === "end_node";
        const finalTrueTarget = trueExists ? trueTarget : `undef_${trueTarget}`;

        if (!trueExists && !rawNodes.some((n) => n.id === finalTrueTarget)) {
          rawNodes.push({
            id: finalTrueTarget,
            type: "step",
            position: { x: 0, y: 0 },
            data: { label: `Undefined (${trueTarget})`, type: "action", isUndefined: true, app: "Broken", initial: "✕", appColor: "#ef4444" },
          });
        }

        rawEdges.push({
          id: `e_${currentId}_true_${finalTrueTarget}`,
          source: currentId,
          sourceHandle: "true",
          target: finalTrueTarget,
          type: "smoothstep",
          label: "Yes",
          labelStyle: { fill: "#065f46", fontWeight: 700, fontSize: "11px" },
          labelBgStyle: { fill: "#d1fae5", fillOpacity: 0.9, rx: 4, ry: 4 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
          style: { stroke: "#10b981", strokeWidth: 2 },
        });

        const falseTarget = s.false_step_id || "end_node";
        const falseExists = stepIdMap.has(falseTarget) || falseTarget === "end_node";
        const finalFalseTarget = falseExists ? falseTarget : `undef_${falseTarget}`;

        if (!falseExists && !rawNodes.some((n) => n.id === finalFalseTarget)) {
          rawNodes.push({
            id: finalFalseTarget,
            type: "step",
            position: { x: 0, y: 0 },
            data: { label: `Undefined (${falseTarget})`, type: "action", isUndefined: true, app: "Broken", initial: "✕", appColor: "#ef4444" },
          });
        }

        rawEdges.push({
          id: `e_${currentId}_false_${finalFalseTarget}`,
          source: currentId,
          sourceHandle: "false",
          target: finalFalseTarget,
          type: "smoothstep",
          label: "No",
          labelStyle: { fill: "#991b1b", fontWeight: 700, fontSize: "11px" },
          labelBgStyle: { fill: "#fee2e2", fillOpacity: 0.9, rx: 4, ry: 4 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
          style: { stroke: "#ef4444", strokeWidth: 2 },
        });
      } else {
        const nextId = s.next_step_id || (idx + 1 < rawSteps.length ? rawSteps[idx + 1].id || `s_${idx + 1}` : "end_node");
        const nextExists = stepIdMap.has(nextId) || nextId === "end_node";
        const finalTarget = nextExists ? nextId : `undef_${nextId}`;

        if (!nextExists && !rawNodes.some((n) => n.id === finalTarget)) {
          rawNodes.push({
            id: finalTarget,
            type: "step",
            position: { x: 0, y: 0 },
            data: { label: `Undefined (${nextId})`, type: "action", isUndefined: true, app: "Broken", initial: "✕", appColor: "#ef4444" },
          });
        }

        rawEdges.push({
          id: `e_${currentId}_${finalTarget}`,
          source: currentId,
          target: finalTarget,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          style: { stroke: "#94a3b8", strokeWidth: 2 },
        });
      }
    });

    if (rawEdges.some((e) => e.target === "end_node")) {
      rawNodes.push({
        id: "end_node",
        type: "step",
        position: { x: 0, y: 0 },
        data: { label: "End", type: "end" },
      });
    }

    const layouted = getLayoutedElements(rawNodes, rawEdges, "LR");
    setNodes(layouted.nodes);
    setEdges(layouted.edges);

    if (layouted.nodes.length > 12) setShowMinimap(true);

    const t = setTimeout(() => {
      fitView({ padding: 0.25, duration: 300 });
    }, 100);
    return () => clearTimeout(t);
  }, [workflow, catalog, fitView, setNodes, setEdges]);

  const [localSimReport, setLocalSimReport] = useState(simReport || null);
  const [simRunning, setSimRunning] = useState(false);

  useEffect(() => {
    if (simReport) setLocalSimReport(simReport);
  }, [simReport]);

  const handleExecuteSimulation = async () => {
    if (!workflow?.id) return;
    try {
      setSimRunning(true);
      const res = await api.simulateWorkflow(workflow.id);
      setLocalSimReport(res);
      setActiveScenarioIdx(0);
      if (res.scenarios?.length > 0) {
        setTimeout(() => {
          handleStartReplay(0, res);
        }, 150);
      }
    } catch (err) {
      console.error("Canvas simulation error", err);
    } finally {
      setSimRunning(false);
    }
  };

  // 2. Simulation Replay Logic
  const scenarios = localSimReport?.scenarios || [];

  const handleStartReplay = (scenarioIndex, customReport = null) => {
    const activeScenarios = customReport?.scenarios || scenarios;
    setActiveScenarioIdx(scenarioIndex);
    const scenario = activeScenarios[scenarioIndex];
    if (!scenario) return;

    setAnimatingScenario(true);
    setExecutedStepIds(new Set());
    setFailedStepId(null);
    clearTimeout(animTimerRef.current);

    const trace = scenario.trace || [];
    let currentStep = 0;

    const playNext = () => {
      if (currentStep < trace.length) {
        const item = trace[currentStep];
        const stepId = item.step_id || `s_${currentStep}`;
        setExecutedStepIds((prev) => new Set([...prev, stepId]));

        if (item.status === "failed" || item.status === "error") {
          setFailedStepId(stepId);
          setAnimatingScenario(false);
          return;
        }

        currentStep++;
        animTimerRef.current = setTimeout(playNext, 350);
      } else {
        setAnimatingScenario(false);
      }
    };

    animTimerRef.current = setTimeout(playNext, 100);
  };

  const handleNodeClick = (_, node) => {
    setSelectedNode(node.data);
  };

  const handleNodeMouseEnter = (_, node) => {
    setHoveredNodeId(node.id);
  };

  const handleNodeMouseLeave = () => {
    setHoveredNodeId(null);
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", position: "relative" }}>
      {/* Canvas Header Toolbar */}
      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "14px",
          right: "14px",
          zIndex: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(8px)",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "8px 14px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {!isEmbedded && onClose && (
            <>
              <button
                className="btn ghost btn-sm"
                onClick={onClose}
                style={{ fontWeight: 600, color: "#334155" }}
              >
                ← Back to Details
              </button>
              <div style={{ height: "18px", width: "1px", background: "#e2e8f0" }} />
            </>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <strong style={{ fontSize: "13px", color: "#0f172a" }}>{workflow.name}</strong>
              <DepartmentBadge department={workflow.department} />
            </div>
            <div style={{ fontSize: "11px", color: "#64748b" }}>
              {nodes.length} nodes · DAG Left-to-Right layout
            </div>
          </div>
        </div>

        {/* Canvas Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            className="btn ghost btn-sm"
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            title="Fit to Screen"
            style={{ fontSize: "12px", padding: "4px 8px" }}
          >
            ⛶ Fit
          </button>
        </div>
      </div>

      {/* Main React Flow Canvas */}
      <div style={{ flex: 1, height: "100%", background: "#f8fafc" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color="#cbd5e1" gap={18} size={1} />
          <Controls style={{ bottom: "16px", right: "16px", left: "auto" }} />
          {showMinimap && (
            <MiniMap
              style={{ bottom: "70px", right: "16px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px" }}
              nodeColor={(n) => (n.data?.type === "trigger" ? "#10b981" : n.data?.type === "condition" ? "#f59e0b" : "#3b82f6")}
            />
          )}
        </ReactFlow>
      </div>

      {/* Slide-in Node Inspector Panel */}
      {selectedNode && (
        <div
          style={{
            width: "300px",
            height: "100%",
            background: "#ffffff",
            borderLeft: "1px solid #e2e8f0",
            boxShadow: "-4px 0 16px rgba(0,0,0,0.05)",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#6366f1", textTransform: "uppercase" }}>
                {selectedNode.type} Node
              </div>
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", margin: "3px 0 0 0" }}>
                {selectedNode.label}
              </h3>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#64748b" }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>OPERATION ID</div>
              <code style={{ fontSize: "12px", color: "#0f172a", wordBreak: "break-all" }}>
                {selectedNode.operationId || "custom.step"}
              </code>
            </div>

            {selectedNode.condition && (
              <div style={{ background: "#fef3c7", padding: "8px 10px", borderRadius: "6px", border: "1px solid #fde68a" }}>
                <div style={{ color: "#92400e", fontSize: "10px", fontWeight: 600 }}>DECISION CONDITION</div>
                <div style={{ fontSize: "12px", color: "#78350f", fontWeight: 600, marginTop: "2px" }}>
                  {selectedNode.condition}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>SIDE EFFECT</div>
                <div style={{ fontWeight: 600, color: selectedNode.sideEffect === "irreversible" ? "#ef4444" : "#0f172a", textTransform: "capitalize" }}>
                  {selectedNode.sideEffect}
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>DAMAGE SCORE</div>
                <div style={{ fontWeight: 600, color: selectedNode.damage >= 7 ? "#ef4444" : "#0f172a" }}>
                  {selectedNode.damage} / 10
                </div>
              </div>
            </div>

            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>ERROR POLICY</div>
              <div style={{ fontSize: "12px", color: selectedNode.hasErrorHandling ? "#10b981" : "#d97706", fontWeight: 500, marginTop: "2px" }}>
                {selectedNode.errorPolicy || (selectedNode.hasErrorHandling ? "Retry on fail (3x)" : "No error policy (Fail immediate)")}
              </div>
            </div>

            {selectedNode.inputs?.length > 0 && (
              <div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "4px" }}>
                  Inputs & Variables
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {selectedNode.inputs.map((inp, ii) => (
                    <div key={ii} style={{ fontSize: "11px", background: "#f1f5f9", padding: "3px 6px", borderRadius: "4px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#334155" }}>{typeof inp === "object" ? inp.name : inp}</span>
                      <span style={{ color: "#64748b" }}>{typeof inp === "object" ? inp.type || "text" : "var"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Canvas View Component (Embedded) ─────────────────────────────────
export function WorkflowCanvasView({ workflow, catalog, simReport, onRunSim, height = "520px" }) {
  if (!workflow) return null;

  return (
    <CanvasErrorBoundary>
      <div style={{ width: "100%", height, position: "relative", borderRadius: "8px", overflow: "hidden", border: "1px solid #e2e8f0" }}>
        <ReactFlowProvider>
          <WorkflowCanvasInner
            workflow={workflow}
            catalog={catalog}
            simReport={simReport}
            onRunSim={onRunSim}
            isEmbedded={true}
          />
        </ReactFlowProvider>
      </div>
    </CanvasErrorBoundary>
  );
}

// ─── Modal Wrapper Component ─────────────────────────────────────────────────
export default function WorkflowCanvasModal({ workflow, onClose, onNavigateToSim }) {
  const [catalog, setCatalog] = useState(null);
  const [simReport, setSimReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!workflow?.id) return;
      try {
        setLoading(true);
        const [catData, simData] = await Promise.all([
          api.getCatalog().catch(() => ({ actions: [], triggers: [] })),
          api.getLastSimulation(workflow.id).catch(() => null),
        ]);
        setCatalog(catData);
        setSimReport(simData);
      } catch (err) {
        console.error("Failed to load canvas metadata", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [workflow]);

  if (!workflow) return null;

  return (
    <CanvasErrorBoundary>
      <div
        className="modal-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(4px)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
      >
        <div
          style={{
            width: "95vw",
            height: "90vh",
            maxWidth: "1400px",
            background: "#ffffff",
            borderRadius: "12px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: "10px", color: "#64748b" }}>
              <Spinner /> Loading visual node canvas…
            </div>
          ) : (
            <ReactFlowProvider>
              <WorkflowCanvasInner
                workflow={workflow}
                onClose={onClose}
                catalog={catalog}
                simReport={simReport}
                onRunSim={() => {
                  onClose();
                  onNavigateToSim?.(workflow.id);
                }}
              />
            </ReactFlowProvider>
          )}
        </div>
      </div>
    </CanvasErrorBoundary>
  );
}
