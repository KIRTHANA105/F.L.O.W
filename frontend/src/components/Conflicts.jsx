import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote, DepartmentBadge } from "./Shared";
import SimulationRecommendation from "./SimulationRecommendation";

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

// ─── System-wide conflicts view (when not reviewing a single proposal) ─────────
function SystemConflictsView({ onDashboard, onNavigate, triggerAiGlow }) {
  const [conflicts, setConflicts] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [seedNotice, setSeedNotice] = useState("");

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cRes, wRes] = await Promise.all([
        api.getConflicts(),
        api.listWorkflows(),
      ]);
      setConflicts(cRes.conflicts || []);
      setWorkflows(wRes.workflows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  const handleSeedSamples = async () => {
    setSeeding(true);
    setError("");
    setSeedNotice("");
    triggerAiGlow?.();
    try {
      const res = await api.seedSampleWorkflows();
      setSeedNotice(
        `✓ Seeded ${res.count} real workflows: Lead Router, Regional Assigner, Sheet Logger.`
      );
      await loadConflicts();
    } catch (e) {
      setError(e.message || "Failed to seed sample workflows");
    } finally {
      setSeeding(false);
    }
  };

  const activeWorkflowCount = workflows.filter((w) => w.status === "active").length;

  return (
    <div className="conflicts-page">
      <div className="conflicts-header">
        <div>
          <h2 className="section-heading">Process Conflict Radar</h2>
          <p className="section-sub">
            Real-time field-level conflict detection across {activeWorkflowCount} active workflow{activeWorkflowCount === 1 ? "" : "s"} (0 LLM calls, pure Python).
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            className="btn secondary btn-sm"
            onClick={handleSeedSamples}
            disabled={seeding || loading}
            style={{ fontWeight: 600 }}
          >
            {seeding ? <Spinner /> : "⚡ Load Sample Workflows"}
          </button>
          <button className="btn ghost btn-sm" onClick={loadConflicts} disabled={loading}>
            {loading ? <Spinner /> : "⟳ Rescan"}
          </button>
        </div>
      </div>

      {seedNotice && (
        <div
          style={{
            background: "rgba(99, 102, 241, 0.08)",
            border: "1px solid #c7d2fe",
            color: "#4338ca",
            padding: "10px 16px",
            borderRadius: "6px",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {seedNotice}
        </div>
      )}

      {error && <ErrorNote message={error} />}

      {loading ? (
        <div className="conflicts-empty" style={{ padding: "40px 20px" }}>
          <Spinner />
          <p style={{ marginTop: 12 }}>Evaluating field paths, trigger loops, and condition intervals...</p>
        </div>
      ) : conflicts.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px", border: "1px solid rgba(16, 185, 129, 0.3)", background: "rgba(16, 185, 129, 0.03)" }}>
          <div style={{ fontSize: "36px", color: "#10b981", marginBottom: 12 }}>✓</div>
          <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#10b981", margin: "0 0 8px 0" }}>
            No conflicts found across your {activeWorkflowCount} active workflow{activeWorkflowCount === 1 ? "" : "s"}
          </h3>
          <p style={{ color: "#64748b", maxWidth: "540px", margin: "0 auto 24px auto", fontSize: "14px", lineHeight: "1.5" }}>
            All active automations operate on isolated field paths. Verified 0 infinite trigger loops, 0 write collisions, and 0 unreachable condition paths across production processes.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn" onClick={onDashboard}>
              Go to Dashboard
            </button>
            <button
              className="btn secondary"
              onClick={handleSeedSamples}
              disabled={seeding}
            >
              {seeding ? <Spinner /> : "⚡ Load Sample Workflows"}
            </button>
            <button className="btn ghost" onClick={() => onNavigate?.("graph")}>
              View Dependency Graph
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⛔ {conflicts.length} Process Conflict{conflicts.length === 1 ? "" : "s"} Detected Across Active Automations</span>
          </div>

          {conflicts.map((c, idx) => {
            const isHigh = c.severity === "high";
            return (
              <div
                key={idx}
                className="card"
                style={{
                  borderLeft: `4px solid ${isHigh ? "#ef4444" : "#f59e0b"}`,
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: isHigh ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: isHigh ? "#ef4444" : "#d97706",
                      }}
                    >
                      {c.severity} SEVERITY
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "rgba(100, 116, 139, 0.1)",
                        color: "#475569",
                      }}
                    >
                      {c.type.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div style={{ fontSize: "12px", color: "#64748b", display: "flex", gap: "6px", alignItems: "center" }}>
                    <span>Involved:</span>
                    {c.involved_workflows?.map((w, wi) => (
                      <span
                        key={wi}
                        style={{
                          background: "#f1f5f9",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontWeight: 600,
                          color: "#334155",
                          cursor: "pointer",
                        }}
                        onClick={() => onNavigate?.("graph", w.id)}
                        title="View in Dependency Graph"
                      >
                        {w.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: "14px", fontWeight: 500, color: "#1e293b", lineHeight: "1.5" }}>
                  {c.message}
                </div>


                {/* Concrete Evidence Box */}
                {c.evidence && (
                  <div
                    style={{
                      background: "rgba(241, 245, 249, 0.7)",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "12px",
                      fontSize: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#475569", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.5px" }}>
                      Concrete Field-Level Evidence
                    </div>
                    {c.evidence.field_paths?.length > 0 && (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: "#64748b" }}>Field paths:</span>
                        {c.evidence.field_paths.map((f, fi) => (
                          <code key={fi} style={{ background: "#ffffff", border: "1px solid #cbd5e1", padding: "1px 6px", borderRadius: "3px", color: "#0f172a", fontFamily: "monospace" }}>
                            {f}
                          </code>
                        ))}
                      </div>
                    )}
                    {c.evidence.cycle_path?.length > 0 && (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: "#64748b" }}>Cycle trajectory:</span>
                        <code style={{ background: "#ffffff", border: "1px solid #cbd5e1", padding: "1px 6px", borderRadius: "3px", color: "#0f172a", fontFamily: "monospace" }}>
                          {c.evidence.cycle_path.join(" → ")}
                        </code>
                      </div>
                    )}
                    {c.evidence.step_ids?.length > 0 && (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: "#64748b" }}>Contradicting step IDs:</span>
                        <span style={{ color: "#334155", fontWeight: 500 }}>
                          [{c.evidence.step_ids.join(", ")}]
                        </span>
                      </div>
                    )}
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
    return (
      <SystemConflictsView
        onDashboard={() => onNavigate?.("dashboard")}
        onNavigate={onNavigate}
        triggerAiGlow={triggerAiGlow}
      />
    );
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

      {/* SVS Simulation Recommendation Engine */}
      {proposal?.id && (
        <SimulationRecommendation
          workflowId={proposal.id}
          onSimulate={(wfId) => onNavigate?.("simulation", wfId)}
          onAdopt={handleAdopt}
          disabled={actionBusy}
        />
      )}

      {/* Fallback & Reject Actions */}
      <div className="conflicts-actions">
        <button
          className="btn danger-outline"
          onClick={handleReject}
          disabled={actionBusy}
        >
          {actionBusy ? <Spinner /> : "✕"} Reject Workflow
        </button>
      </div>
    </div>
  );
}
