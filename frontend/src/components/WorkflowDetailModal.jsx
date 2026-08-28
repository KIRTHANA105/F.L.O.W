import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DepartmentBadge, Spinner } from "./Shared";
import WorkflowCanvasModal, { WorkflowCanvasView } from "./WorkflowCanvasModal";
import CreateWorkflowModal from "./CreateWorkflowModal";

/**
 * Modal showing the full workflow detail:
 * - Embedded n8n-style visual node graph canvas
 * - Architecture sequence step blocks
 * - Business Rules & Decision Gates
 * - Direct Automation vs Simulation Action Gate
 */
export default function WorkflowDetailModal({
  workflow,
  onClose,
  onNavigateToSim,
  onAdopt,
  onRecalculate,
  onRefresh,
  triggerAiGlow,
}) {
  const ref = useRef(null);
  const [activeTab, setActiveTab] = useState("steps"); // Default to steps view as shown in user screenshot
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [simReport, setSimReport] = useState(null);
  const [rec, setRec] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [converting, setConverting] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(true);

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === ref.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Load catalog, simulation trace, and recommendation on mount
  useEffect(() => {
    async function loadMeta() {
      if (!workflow?.id) return;
      try {
        setLoadingMetadata(true);
        const [catData, simData, recData] = await Promise.all([
          api.getCatalog().catch(() => ({ actions: [], triggers: [] })),
          api.getLastSimulation(workflow.id).catch(() => null),
          api.getRecommendation(workflow.id).catch(() => null),
        ]);
        setCatalog(catData);
        setSimReport(simData);
        setRec(recData);
      } catch (err) {
        console.error("Failed to load workflow metadata", err);
      } finally {
        setLoadingMetadata(false);
      }
    }
    loadMeta();
  }, [workflow]);

  if (!workflow) return null;

  if (isFullscreen) {
    return (
      <WorkflowCanvasModal
        workflow={workflow}
        onClose={() => setIsFullscreen(false)}
        onNavigateToSim={(wfId) => {
          setIsFullscreen(false);
          onClose();
          onNavigateToSim?.(wfId);
        }}
      />
    );
  }

  const steps = workflow.steps || [];
  const triggerStep = steps[0] || null;
  const actionSteps = steps.slice(1);
  const hasRules = workflow.business_rules && workflow.business_rules.length > 0;

  return (
    <div className="modal-backdrop" ref={ref} onClick={handleBackdrop}>
      <div
        className="modal-panel workflow-detail-modal"
        style={{
          maxWidth: "1080px",
          width: "95vw",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div className="modal-header" style={{ paddingBottom: "12px", borderBottom: "1px solid #e2e8f0" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <DepartmentBadge department={workflow.department} />
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                {steps.length} step{steps.length !== 1 ? "s" : ""}
              </span>
              {workflow.status === "in_progress" ? (
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#e0e7ff", color: "#4338ca", border: "1px solid #c7d2fe", padding: "2px 8px", borderRadius: "100px" }}>
                  ⚡ IN PROGRESS
                </span>
              ) : workflow.status === "created" || (workflow.is_proposed && workflow.status !== "review" && workflow.status !== "active") ? (
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "100px" }}>
                  ⚡ CREATED
                </span>
              ) : workflow.status === "review" ? (
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: "100px" }}>
                  ⚠ NEEDS REVIEW
                </span>
              ) : (
                <span style={{ fontSize: "11px", fontWeight: 700, background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: "100px" }}>
                  ✓ ACTIVE
                </span>
              )}
            </div>
            <h2 className="modal-title" style={{ fontSize: "20px", margin: "2px 0 4px 0" }}>{workflow.name}</h2>
            <p className="modal-desc" style={{ margin: 0, fontSize: "13px" }}>{workflow.description}</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="btn secondary btn-sm"
              onClick={() => setIsFullscreen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600 }}
              title="Expand to full screen canvas"
            >
              ⛶ Fullscreen Canvas
            </button>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {/* AI Suggestion & Direct Execution / Simulation Action Bar */}
        <div
          style={{
            background: rec?.tier === "DIRECT" ? "rgba(16, 185, 129, 0.06)" : "rgba(99, 102, 241, 0.05)",
            borderBottom: "1px solid #e2e8f0",
            padding: "12px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>{rec?.tier === "DIRECT" ? "✓" : "💡"}</span>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: rec?.tier === "DIRECT" ? "#166534" : "#312e81" }}>
                AI Suggestion: {rec?.tier === "DIRECT" ? "Safe for Direct Automation Execution" : `Simulation Recommended (${rec?.tier || "STANDARD"} Verification Tier)`}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>
                {rec?.headline || "Review architecture steps or run virtual simulation to stress test boundary paths."}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              className="btn primary btn-sm"
              onClick={async () => {
                try {
                  await api.updateWorkflowStatus(workflow.id, "in_progress");
                  workflow.status = "in_progress";
                } catch (err) {
                  console.error("Failed to set in_progress status", err);
                }
                onClose();
                if (onNavigateToSim) {
                  await onNavigateToSim(workflow.id);
                }
                onRefresh?.();
              }}
              style={{ fontWeight: 600, fontSize: "12px", padding: "6px 14px" }}
            >
              ⚡ Go for Simulation
            </button>

            <button
              className="btn success btn-sm"
              onClick={async () => {
                setConverting(true);
                try {
                  if (onAdopt) {
                    await onAdopt(workflow);
                  } else {
                    await api.adoptWorkflow(workflow.id);
                  }
                  onClose();
                  onRefresh?.();
                } catch (e) {
                  console.error(e);
                } finally {
                  setConverting(false);
                }
              }}
              disabled={converting}
              style={{ fontWeight: 700, fontSize: "12px", padding: "6px 14px", background: "#10b981", color: "#ffffff", border: "none" }}
            >
              {converting ? <Spinner /> : "✓ Direct Execution"}
            </button>

            <button
              className="btn secondary btn-sm"
              onClick={() => setShowEditModal(true)}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              ✏ Edit Workflow
            </button>
          </div>
        </div>

        {/* View Mode Segmented Controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 24px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <button
            onClick={() => setActiveTab("canvas")}
            className="btn btn-sm"
            style={{
              background: activeTab === "canvas" ? "#6366f1" : "#ffffff",
              color: activeTab === "canvas" ? "#ffffff" : "#475569",
              border: activeTab === "canvas" ? "1px solid #6366f1" : "1px solid #cbd5e1",
              fontWeight: 600,
              fontSize: "12px",
              padding: "5px 14px",
            }}
          >
            ☊ Visual Node Graph
          </button>

          <button
            onClick={() => setActiveTab("steps")}
            className="btn btn-sm"
            style={{
              background: activeTab === "steps" ? "#6366f1" : "#ffffff",
              color: activeTab === "steps" ? "#ffffff" : "#475569",
              border: activeTab === "steps" ? "1px solid #6366f1" : "1px solid #cbd5e1",
              fontWeight: 600,
              fontSize: "12px",
              padding: "5px 14px",
            }}
          >
            ⚡ Architecture Steps ({steps.length})
          </button>

          {hasRules && (
            <button
              onClick={() => setActiveTab("rules")}
              className="btn btn-sm"
              style={{
                background: activeTab === "rules" ? "#6366f1" : "#ffffff",
                color: activeTab === "rules" ? "#ffffff" : "#475569",
                border: activeTab === "rules" ? "1px solid #6366f1" : "1px solid #cbd5e1",
                fontWeight: 600,
                fontSize: "12px",
                padding: "5px 14px",
              }}
            >
              📋 Decision Rules ({workflow.business_rules.length})
            </button>
          )}
        </div>

        {/* Modal Content Body */}
        <div className="modal-body" style={{ padding: activeTab === "canvas" ? "12px 24px 20px 24px" : "20px 24px", overflowY: "auto" }}>
          
          {/* TAB 1: Visual Node Graph Canvas (Embedded in Modal) */}
          {activeTab === "canvas" && (
            <div>
              {loadingMetadata ? (
                <div style={{ height: "480px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", color: "#64748b" }}>
                  <Spinner /> Preparing node canvas layout…
                </div>
              ) : (
                <WorkflowCanvasView
                  workflow={workflow}
                  catalog={catalog}
                  simReport={simReport}
                  onRunSim={() => {
                    onClose();
                    onNavigateToSim?.(workflow.id);
                  }}
                  height="490px"
                />
              )}
            </div>
          )}

          {/* TAB 2: Architecture Step Sequence */}
          {activeTab === "steps" && (
            <div className="modal-section">
              <div className="modal-section-label">Sequence Structure</div>

              {/* ⚡ TRIGGER BLOCK */}
              {triggerStep && (
                <div className="trigger-action-block trigger-block">
                  <div className="block-header">
                    <span className="block-pill trigger-pill">⚡ TRIGGER</span>
                    <span className="block-meta-source">Event Intake</span>
                  </div>
                  <div className="block-body">
                    <div className="block-name">{triggerStep.name}</div>
                    {triggerStep.description && (
                      <div className="block-desc">{triggerStep.description}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Downstream Connector Arrow */}
              {actionSteps.length > 0 && (
                <div className="flow-vertical-connector">
                  <span className="connector-line" />
                  <span className="connector-badge">then execute {actionSteps.length} action{actionSteps.length !== 1 ? "s" : ""}</span>
                  <span className="connector-line" />
                </div>
              )}

              {/* ⚙ ACTIONS SEQUENCE */}
              <div className="actions-sequence">
                {actionSteps.map((action, idx) => (
                  <div key={idx} className="trigger-action-block action-block">
                    <div className="block-header">
                      <span className="block-pill action-pill">⚙ ACTION {idx + 1}</span>
                      <span className="block-meta-step">Step {idx + 2} of {steps.length}</span>
                    </div>
                    <div className="block-body">
                      <div className="block-name">{action.name}</div>
                      {action.description && (
                        <div className="block-desc">{action.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Business Rules */}
          {activeTab === "rules" && hasRules && (
            <div className="modal-section">
              <div className="modal-section-label">Business Rules & Decision Gates</div>
              <div className="business-rules-list">
                {workflow.business_rules.map((rule, i) => (
                  <div key={i} className="business-rule-row">
                    <div className="rule-condition">
                      <span className="rule-icon">◆</span>
                      <span>{rule.condition}</span>
                    </div>
                    <div className="rule-arrow">→</div>
                    <div className="rule-path">{rule.path}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Workflow Modal */}
      {showEditModal && (
        <CreateWorkflowModal
          initialText={`${workflow.name}: ${workflow.description}`}
          onClose={() => setShowEditModal(false)}
          onResult={(res) => {
            setShowEditModal(false);
            onClose();
            onRecalculate?.(res);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}
    </div>
  );
}
