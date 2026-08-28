import { useState } from "react";
import { api } from "../api";
import { DepartmentBadge, StatusDot, Spinner } from "./Shared";
import WorkflowDetailModal from "./WorkflowDetailModal";
import CreateWorkflowModal from "./CreateWorkflowModal";

const DEPT_ORDER = [
  "Sales",
  "Finance",
  "Legal",
  "Customer Success",
  "Support",
  "Procurement",
  "Operations",
];

const DEPT_COLORS = {
  Sales: "#6366f1",
  Finance: "#10b981",
  Legal: "#f59e0b",
  "Customer Success": "#3b82f6",
  Support: "#8b5cf6",
  Procurement: "#f97316",
  Operations: "#6b7280",
};

function WorkflowCard({ workflow, onClick }) {
  const connectionCount =
    (workflow.leads_to?.length || 0) + (workflow.depends_on?.length || 0);
  const previewSteps = (workflow.steps || []).slice(0, 4);

  const isReview = workflow.status === "review" || workflow.status === "needs_review";
  const isInProgress = workflow.status === "in_progress" || workflow.status === "simulating";
  const isCreated = (workflow.status === "created" || (workflow.is_proposed && workflow.status !== "active")) && !isReview && !isInProgress;

  return (
    <div
      className={`workflow-card ${isReview ? "needs-review-card" : isInProgress ? "in-progress-card" : isCreated ? "created-card" : ""}`}
      onClick={() => onClick(workflow)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick(workflow)}
      aria-label={`View details for ${workflow.name}`}
      style={{
        borderLeft: isReview
          ? "4px solid #ef4444"
          : isInProgress
          ? "4px solid #6366f1"
          : isCreated
          ? "4px solid #f59e0b"
          : "4px solid #10b981"
      }}
    >
      <div className="wf-card-header">
        <DepartmentBadge department={workflow.department} />
        {isInProgress ? (
          <span style={{ fontSize: "11px", fontWeight: 700, background: "#e0e7ff", color: "#4338ca", border: "1px solid #c7d2fe", padding: "2px 8px", borderRadius: "100px" }}>
            ⚡ IN PROGRESS
          </span>
        ) : isCreated ? (
          <span style={{ fontSize: "11px", fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "100px" }}>
            ⚡ CREATED
          </span>
        ) : isReview ? (
          <span style={{ fontSize: "11px", fontWeight: 700, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: "100px" }}>
            ⚠ NEEDS REVIEW
          </span>
        ) : (
          <StatusDot status="Active" />
        )}
      </div>

      <h3 className="wf-card-name">{workflow.name}</h3>
      <p className="wf-card-desc">{workflow.description}</p>

      <div className="wf-card-steps">
        {previewSteps.map((s, i) => (
          <span key={i} className="wf-step-chip">
            {s.name}
            {i < previewSteps.length - 1 && (
              <span className="wf-step-arrow"> →</span>
            )}
          </span>
        ))}
        {(workflow.steps || []).length > 4 && (
          <span className="wf-step-chip muted">
            +{workflow.steps.length - 4} more
          </span>
        )}
      </div>

      <div className="wf-card-footer">
        <span className="wf-meta">
          {workflow.steps?.length || 0} steps
        </span>
        {connectionCount > 0 && (
          <span className="wf-meta wf-connections">
            ⟷ {connectionCount} connection{connectionCount !== 1 ? "s" : ""}
          </span>
        )}
        {workflow.business_rules?.length > 0 && (
          <span className="wf-meta wf-rules">
            ◆ {workflow.business_rules.length} rule
            {workflow.business_rules.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── AI Suggest Result Card ──────────────────────────────────────────────────
function AiSuggestionCard({ suggestion, onCreateThis, onDismiss }) {
  const dept = suggestion.department;
  const accentColor = DEPT_COLORS[dept] || "#6366f1";

  return (
    <div
      className="ai-suggestion-card"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(16,185,129,0.04) 100%)",
        border: "1px solid rgba(99,102,241,0.25)",
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: "14px",
        padding: "20px 24px",
        marginBottom: "24px",
        position: "relative",
        animation: "fadeSlideIn 0.35s ease",
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: "absolute", top: 14, right: 14,
          background: "none", border: "none", cursor: "pointer",
          color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 2,
        }}
        aria-label="Dismiss suggestion"
      >✕</button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}11)`,
          border: `1px solid ${accentColor}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}>✦</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6366f1", marginBottom: 2 }}>
            AI Suggested Next Workflow
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
            {suggestion.name}
          </div>
        </div>
        <DepartmentBadge department={dept} />
      </div>

      <p style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.6, margin: "0 0 16px 0" }}>
        {suggestion.rationale}
      </p>

      <div style={{
        background: "rgba(255,255,255,0.7)",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: 13,
        color: "#334155",
        fontStyle: "italic",
        lineHeight: 1.5,
      }}>
        "{suggestion.suggested_text}"
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn create-btn btn-sm"
          onClick={onCreateThis}
          style={{ fontSize: 13 }}
        >
          → Create This Workflow
        </button>
        <button
          className="btn ghost btn-sm"
          onClick={onDismiss}
          style={{ fontSize: 13 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({
  workflows,
  onRefresh,
  onCreateWorkflow,
  onAdopt,
  onNavigateToSim,
  onRecalculate,
  triggerAiGlow,
  justDeployed,
}) {
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitialText, setCreateInitialText] = useState("");

  // AI Suggest state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestError, setAiSuggestError] = useState("");
  const [noPolicyGate, setNoPolicyGate] = useState(false);

  // Group by department in a stable order
  const byDept = {};
  for (const wf of workflows) {
    byDept[wf.department] = byDept[wf.department] || [];
    byDept[wf.department].push(wf);
  }
  const orderedDepts = DEPT_ORDER.filter((d) => byDept[d]);

  const handleCardClick = (wf) => setSelectedWorkflow(wf);

  const handleOpenCreate = (initialText = "") => {
    setCreateInitialText(initialText);
    setShowCreate(true);
  };

  const handleAiSuggest = async () => {
    setAiSuggestion(null);
    setAiSuggestError("");
    setNoPolicyGate(false);
    setAiSuggesting(true);
    triggerAiGlow?.();
    try {
      const result = await api.suggestNextWorkflow();
      setAiSuggestion(result);
    } catch (e) {
      if (e.message === "NO_POLICY") {
        setNoPolicyGate(true);
      } else {
        setAiSuggestError(e.message || "Could not generate suggestion.");
      }
    } finally {
      setAiSuggesting(false);
    }
  };

  return (
    <div className="dashboard-page">
      {justDeployed && (
        <div className="ok-banner adoption-banner">
          ✓ <strong>"{justDeployed}"</strong> has been added to Nexora's process memory.
        </div>
      )}

      <div className="dashboard-header">
        <div>
          <h2 className="section-heading">Active Workflows</h2>
          <p className="section-sub">
            How Nexora Technologies currently operates — {workflows.length}{" "}
            workflows across {orderedDepts.length} departments.
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="btn ghost btn-sm" onClick={onRefresh}>
            ↻ Refresh
          </button>
          <button
            id="ai-suggest-btn"
            className="btn secondary btn-sm"
            onClick={handleAiSuggest}
            disabled={aiSuggesting}
            title="AI suggests the next workflow to automate based on your policies and existing workflows"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            {aiSuggesting ? (
              <><Spinner /> Thinking…</>
            ) : (
              <>✦ AI Suggest</>
            )}
          </button>
          <button
            id="create-workflow-btn"
            className="btn create-btn"
            onClick={() => handleOpenCreate("")}
            title="Propose a new workflow"
          >
            + New Workflow
          </button>
        </div>
      </div>

      {/* No-Policy Gate callout */}
      {noPolicyGate && (
        <div style={{
          background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
          border: "1px solid #fde68a",
          borderLeft: "4px solid #f59e0b",
          borderRadius: 12,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}>
          <span style={{ fontSize: 22 }}>📋</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#92400e", fontSize: 14, marginBottom: 4 }}>
              Company Policy Required
            </div>
            <p style={{ color: "#78350f", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              The AI Suggest feature uses your company's policy documents to understand what workflows matter most.
              Please upload at least one policy document in the <strong>Policies</strong> tab first, then try again.
            </p>
          </div>
          <button
            className="btn ghost btn-sm"
            onClick={() => setNoPolicyGate(false)}
            style={{ flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* AI Suggestion Error */}
      {aiSuggestError && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
          padding: "12px 16px", marginBottom: 20, color: "#991b1b", fontSize: 13,
        }}>
          ⚠ {aiSuggestError}
          <button className="btn ghost btn-sm" style={{ marginLeft: 12 }} onClick={() => setAiSuggestError("")}>✕</button>
        </div>
      )}

      {/* AI Suggestion Result Card */}
      {aiSuggestion && (
        <AiSuggestionCard
          suggestion={aiSuggestion}
          onCreateThis={() => {
            setAiSuggestion(null);
            handleOpenCreate(aiSuggestion.suggested_text);
          }}
          onDismiss={() => setAiSuggestion(null)}
        />
      )}

      {workflows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <p>No workflows yet. Click <strong>+ New Workflow</strong> to begin.</p>
        </div>
      ) : (
        orderedDepts.map((dept) => (
          <div key={dept} className="dept-section">
            <div className="dept-label">
              <DepartmentBadge department={dept} />
              <span className="dept-count">{byDept[dept].length} workflow{byDept[dept].length !== 1 ? "s" : ""}</span>
            </div>
            <div className="workflow-grid">
              {byDept[dept].map((wf) => (
                <WorkflowCard
                  key={wf.id}
                  workflow={wf}
                  onClick={handleCardClick}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {selectedWorkflow && (
        <WorkflowDetailModal
          workflow={selectedWorkflow}
          onClose={() => setSelectedWorkflow(null)}
          onAdopt={onAdopt}
          onNavigateToSim={onNavigateToSim}
          onRecalculate={onRecalculate}
          onRefresh={onRefresh}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {showCreate && (
        <CreateWorkflowModal
          onClose={() => {
            setShowCreate(false);
            setCreateInitialText("");
          }}
          onResult={(result) => {
            setShowCreate(false);
            setCreateInitialText("");
            onCreateWorkflow(result);
          }}
          triggerAiGlow={triggerAiGlow}
          initialText={createInitialText}
        />
      )}
    </div>
  );
}
