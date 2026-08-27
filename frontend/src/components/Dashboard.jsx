import { useState } from "react";
import { DepartmentBadge, StatusDot } from "./Shared";
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

function WorkflowCard({ workflow, onClick }) {
  const connectionCount =
    (workflow.leads_to?.length || 0) + (workflow.depends_on?.length || 0);
  const previewSteps = (workflow.steps || []).slice(0, 4);

  const isReview = workflow.status === "review" || workflow.status === "needs_review";
  const isCreated = (workflow.status === "created" || (workflow.is_proposed && workflow.status !== "active")) && !isReview;

  return (
    <div
      className={`workflow-card ${isReview ? "needs-review-card" : isCreated ? "created-card" : ""}`}
      onClick={() => onClick(workflow)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick(workflow)}
      aria-label={`View details for ${workflow.name}`}
      style={{
        borderLeft: isReview ? "4px solid #ef4444" : isCreated ? "4px solid #f59e0b" : "4px solid #10b981"
      }}
    >
      <div className="wf-card-header">
        <DepartmentBadge department={workflow.department} />
        {isCreated ? (
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

  // Group by department in a stable order
  const byDept = {};
  for (const wf of workflows) {
    byDept[wf.department] = byDept[wf.department] || [];
    byDept[wf.department].push(wf);
  }
  const orderedDepts = DEPT_ORDER.filter((d) => byDept[d]);

  const handleCardClick = (wf) => setSelectedWorkflow(wf);

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
            id="create-workflow-btn"
            className="btn create-btn"
            onClick={() => setShowCreate(true)}
            title="Propose a new workflow"
          >
            + New Workflow
          </button>
        </div>
      </div>

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
          onClose={() => setShowCreate(false)}
          onResult={(result) => {
            setShowCreate(false);
            onCreateWorkflow(result);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}
    </div>
  );
}
