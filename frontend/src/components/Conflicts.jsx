import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote, DepartmentBadge } from "./Shared";

/**
 * Conflicts page — three-panel layout:
 *   LEFT   : proposed workflow (user's description + structured steps)
 *   CENTER : relevant section of process memory (animated path)
 *   RIGHT  : applicable policies (highlighted when violated)
 *
 * Below: verdict banner + Adopt / Reject actions.
 */

// ─── Step flow helper ─────────────────────────────────────────────────────────
function MiniFlow({ steps, highlightSet, conflictSet }) {
  return (
    <div className="mini-flow">
      {(steps || []).map((s, i) => {
        const name = typeof s === "string" ? s : s.name;
        const isConflict = conflictSet?.has(name);
        const isHighlight = highlightSet?.has(name);
        return (
          <div key={i} className="mini-flow-item">
            <div
              className={`mini-step${isConflict ? " conflict-step" : ""}${isHighlight ? " highlight-step" : ""}`}
            >
              {isConflict && <span className="conflict-icon">✕</span>}
              {isHighlight && !isConflict && (
                <span className="highlight-icon">✓</span>
              )}
              <span>{name}</span>
            </div>
            {i < (steps || []).length - 1 && (
              <div
                className={`mini-connector${isConflict ? " conflict-connector" : ""}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Left panel: proposed workflow ───────────────────────────────────────────
function ProposedPanel({ rawText, proposal }) {
  return (
    <div className="conflicts-panel proposed-panel">
      <div className="panel-label">Proposed Workflow</div>
      <div className="proposed-quote">"{rawText}"</div>
      {proposal && (
        <>
          <div className="proposed-name">{proposal.name}</div>
          <DepartmentBadge department={proposal.department} />
          <p className="proposed-desc" style={{ marginTop: 8 }}>
            {proposal.description}
          </p>
          <div className="panel-sublabel" style={{ marginTop: 16 }}>
            As structured steps
          </div>
          <MiniFlow steps={proposal.steps} />
        </>
      )}
    </div>
  );
}

// ─── Center panel: process memory path ───────────────────────────────────────
function ProcessMemoryPanel({ evaluation, animating }) {
  if (!evaluation) return null;

  const {
    existing_path,
    origin_workflow,
    target_workflow,
    skipped_workflows,
    status,
  } = evaluation;

  const skippedIds = new Set((skipped_workflows || []).map((w) => w.id));
  const targetId = target_workflow?.id;

  return (
    <div className="conflicts-panel memory-panel">
      <div className="panel-label">Process Memory</div>
      <p className="panel-sub">
        Existing process architecture — how this company currently operates
      </p>

      {(existing_path || []).length === 0 ? (
        <div className="memory-empty">
          This workflow doesn't connect to any existing process.
        </div>
      ) : (
        <div className={`process-path${animating ? " animating" : ""}`}>
          {(existing_path || []).map((wf, i) => {
            const isSkipped = skippedIds.has(wf.id);
            const isTarget = wf.id === targetId;
            const isOrigin = wf.id === origin_workflow?.id;

            return (
              <div key={wf.id} className="path-node-wrap">
                <div
                  className={[
                    "path-node",
                    isOrigin ? "origin-node" : "",
                    isSkipped ? "skipped-node" : "",
                    isTarget && status === "conflict" ? "target-conflict-node" : "",
                    isTarget && status !== "conflict" ? "target-ok-node" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <DepartmentBadge department={wf.department} />
                  <div className="path-node-name">{wf.name}</div>
                  {isSkipped && (
                    <div className="skip-label">SKIPPED BY PROPOSAL</div>
                  )}
                </div>
                {i < (existing_path || []).length - 1 && (
                  <div
                    className={`path-edge${isSkipped ? " edge-skipped" : ""}`}
                  >
                    <span className="edge-arrow">↓</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Right panel: policies ────────────────────────────────────────────────────
function PoliciesPanel({ evaluation }) {
  const violated = evaluation?.violated_rules || [];
  const violatedIds = new Set(violated.map((r) => r.id));

  const [docs, setDocs] = useState([]);
  useEffect(() => {
    api
      .policyDocuments()
      .then((d) => setDocs(d.documents || []))
      .catch(() => {});
  }, []);

  const allRules = docs.flatMap((d) => d.rules || []);

  return (
    <div className="conflicts-panel policies-panel">
      <div className="panel-label">Company Policies</div>
      <p className="panel-sub">
        Rules governing Nexora's operational processes
      </p>
      {allRules.length === 0 && (
        <div className="memory-empty">No policies uploaded yet.</div>
      )}
      <div className="policy-cards">
        {docs.map((doc) => (
          <div key={doc.id} className="policy-doc-group">
            <div className="policy-doc-name">§ {doc.filename.replace(/\.[^.]+$/, "").replace(/-/g, " ")}</div>
            {(doc.rules || []).map((rule) => {
              const isViolated = violatedIds.has(rule.id);
              return (
                <div
                  key={rule.id}
                  className={`policy-card-item${isViolated ? " policy-violated" : ""}`}
                >
                  {isViolated && (
                    <div className="policy-violated-tag">⚑ APPLIES</div>
                  )}
                  <div className="policy-card-title">{rule.title}</div>
                  <div className="policy-card-text">{rule.text}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Verdict banner ───────────────────────────────────────────────────────────
function VerdictBanner({ status, reasoning, explanation, explaining, onExplain }) {
  if (!status) return null;

  const isConflict = status === "conflict";
  const isWarning = status === "warning";
  const isCompatible = status === "compatible";

  return (
    <div
      className={`verdict-banner${isConflict ? " verdict-conflict" : isWarning ? " verdict-warning" : " verdict-ok"}`}
    >
      <div className="verdict-icon">
        {isConflict ? "⛔" : isWarning ? "⚠" : "✓"}
      </div>
      <div className="verdict-content">
        <div className="verdict-title">
          {isConflict
            ? "CONFLICT DETECTED"
            : isWarning
              ? "WARNING — Process Deviation"
              : "WORKFLOW COMPATIBLE"}
        </div>
        <div className="verdict-reasoning">{reasoning}</div>
        {explanation && (
          <div className="verdict-explanation">{explanation}</div>
        )}
      </div>
      {!explanation && (
        <button
          className={`btn${isConflict ? " danger" : " secondary"} btn-sm`}
          onClick={onExplain}
          disabled={explaining}
        >
          {explaining ? <><Spinner /> Explaining…</> : "✦ Explain"}
        </button>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ onDashboard }) {
  return (
    <div className="conflicts-empty">
      <div className="empty-icon-lg">⟳</div>
      <h3>No workflow proposed yet</h3>
      <p>
        Use the <strong>+ New Workflow</strong> button on the dashboard to
        describe a workflow. The system will evaluate it against Nexora's
        existing process architecture and policies — and show you the result here.
      </p>
      <button className="btn" onClick={onDashboard}>
        Go to Dashboard
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Conflicts({
  pending,      // { proposal, evaluation, rawText } from CreateWorkflowModal
  onAdopt,
  onReject,
  onNavigate,
  triggerAiGlow,
}) {
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState("");
  const [animating, setAnimating] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Trigger animation when a new proposal arrives
  useEffect(() => {
    if (pending) {
      setExplanation("");
      setExplainError("");
      setAdopted(false);
      setRejected(false);
      setAnimating(true);
      const t = setTimeout(() => setAnimating(false), 2500);
      return () => clearTimeout(t);
    }
  }, [pending]);

  const handleExplain = useCallback(async () => {
    if (!pending) return;
    triggerAiGlow?.();
    setExplaining(true);
    setExplainError("");
    try {
      const res = await api.explainEvaluation({
        proposal: pending.proposal,
        status: pending.evaluation.status,
        origin_workflow: pending.evaluation.origin_workflow,
        target_workflow: pending.evaluation.target_workflow,
        skipped_workflows: pending.evaluation.skipped_workflows,
        violated_rules: pending.evaluation.violated_rules,
        reasoning: pending.evaluation.reasoning,
      });
      setExplanation(res.explanation);
    } catch (e) {
      setExplainError(e.message);
    } finally {
      setExplaining(false);
    }
  }, [pending, triggerAiGlow]);

  const handleAdopt = async () => {
    if (!pending) return;
    triggerAiGlow?.();
    setActionBusy(true);
    try {
      const adopted = await api.adoptWorkflow(
        pending.proposal.id,
        pending.evaluation.origin_workflow?.id,
        null
      );
      setAdopted(true);
      onAdopt?.(adopted.workflow);
    } catch (e) {
      setExplainError(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async () => {
    if (!pending) return;
    setActionBusy(true);
    try {
      await api.rejectWorkflow(pending.proposal.id);
      setRejected(true);
      onReject?.();
    } catch (e) {
      setExplainError(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  if (!pending) {
    return <EmptyState onDashboard={() => onNavigate("dashboard")} />;
  }

  const { proposal, evaluation, rawText } = pending;
  const status = evaluation?.status;

  if (adopted) {
    return (
      <div className="conflicts-empty">
        <div className="verdict-ok-large">✓</div>
        <h3>Workflow Adopted</h3>
        <p>
          <strong>"{proposal.name}"</strong> has been added to Nexora's process
          memory.
        </p>
        <button className="btn" onClick={() => onNavigate("dashboard")}>
          View Dashboard
        </button>
      </div>
    );
  }

  if (rejected) {
    return (
      <div className="conflicts-empty">
        <div className="empty-icon-lg" style={{ opacity: 0.5 }}>✕</div>
        <h3>Workflow Rejected</h3>
        <p>The proposed workflow was not added to process memory.</p>
        <button className="btn" onClick={() => onNavigate("dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="conflicts-page">
      {/* Header */}
      <div className="conflicts-header">
        <div>
          <h2 className="section-heading">Conflict Analysis</h2>
          <p className="section-sub">
            Evaluating the proposed workflow against Nexora's existing process
            architecture and policies.
          </p>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className={`conflicts-panels${animating ? " panels-animating" : ""}`}>
        <ProposedPanel rawText={rawText} proposal={proposal} />
        <ProcessMemoryPanel evaluation={evaluation} animating={animating} />
        <PoliciesPanel evaluation={evaluation} />
      </div>

      {/* Verdict */}
      <VerdictBanner
        status={status}
        reasoning={evaluation?.reasoning}
        explanation={explanation}
        explaining={explaining}
        onExplain={handleExplain}
      />

      {explainError && <ErrorNote message={explainError} />}

      {/* Actions */}
      <div className="conflicts-actions">
        <button
          className="btn danger-outline"
          onClick={handleReject}
          disabled={actionBusy}
        >
          {actionBusy ? <Spinner /> : "✕"} Reject Workflow
        </button>
        {status !== "conflict" && (
          <button
            className="btn success"
            onClick={handleAdopt}
            disabled={actionBusy}
          >
            {actionBusy ? <Spinner /> : "✓"} Adopt Workflow
          </button>
        )}
      </div>
    </div>
  );
}
