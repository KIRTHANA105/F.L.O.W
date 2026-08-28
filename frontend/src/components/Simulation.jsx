import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DepartmentBadge, Spinner, ErrorNote } from "./Shared";

/**
 * One page: pick a workflow (or land here straight from a new proposal),
 * see how it fits the company's process memory and policies, check what
 * it conflicts with, then either simulate it or push it live. Everything
 * that used to be spread across Conflicts and the Decision Gate lives here
 * now, scoped to whichever workflow is selected — no separate pages that
 * re-fetch and re-render the same conflict/recommendation data.
 */

const DEPT_FILTER_OPTIONS = [
  "All", "Sales", "Finance", "Legal", "Customer Success",
  "Support", "Procurement", "Operations",
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "created", label: "Created" },
  { value: "in_progress", label: "In Progress" },
  { value: "review", label: "Needs Review" },
  { value: "active", label: "Active" },
];

const STEPS_FILTER_OPTIONS = [
  { value: "all", label: "Any" },
  { value: "small", label: "1–3" },
  { value: "medium", label: "4–6" },
  { value: "large", label: "7+" },
];

// ─── Step flow mini-diagram (proposed workflow, or any workflow's steps) ───
function MiniFlow({ steps, highlightSet, conflictSet }) {
  return (
    <div className="mini-flow">
      {(steps || []).map((s, i) => {
        const name = typeof s === "string" ? s : s.name;
        const isConflict = conflictSet?.has(name);
        const isHighlight = highlightSet?.has(name);
        return (
          <div key={i} className="mini-flow-item">
            <div className={`mini-step${isConflict ? " conflict-step" : ""}${isHighlight ? " highlight-step" : ""}`}>
              {isConflict && <span className="conflict-icon">✕</span>}
              {isHighlight && !isConflict && <span className="highlight-icon">✓</span>}
              <span>{name}</span>
            </div>
            {i < (steps || []).length - 1 && (
              <div className={`mini-connector${isConflict ? " conflict-connector" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Process Memory path: where this workflow attaches, and what it skips ───
function ProcessMemoryPanel({ evaluation }) {
  if (!evaluation) return null;
  const { existing_path, origin_workflow, target_workflow, skipped_workflows, status } = evaluation;
  const skippedIds = new Set((skipped_workflows || []).map((w) => w.id));
  const targetId = target_workflow?.id;

  return (
    <div className="conflicts-panel memory-panel">
      <div className="panel-label">Process Memory</div>
      <p className="panel-sub">Existing process architecture — how this company currently operates</p>
      {(existing_path || []).length === 0 ? (
        <div className="memory-empty">This workflow doesn't connect to any existing process.</div>
      ) : (
        <div className="process-path">
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
                  ].filter(Boolean).join(" ")}
                >
                  <DepartmentBadge department={wf.department} />
                  <div className="path-node-name">{wf.name}</div>
                  {isSkipped && <div className="skip-label">SKIPPED BY PROPOSAL</div>}
                </div>
                {i < (existing_path || []).length - 1 && (
                  <div className={`path-edge${isSkipped ? " edge-skipped" : ""}`}>
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

// ─── Company policies, with the ones that apply to this workflow flagged ───
function PoliciesPanel({ evaluation }) {
  const violated = evaluation?.violated_rules || [];
  const violatedIds = new Set(violated.map((r) => r.id));
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    api.policyDocuments().then((d) => setDocs(d.documents || [])).catch(() => {});
  }, []);

  const allRules = docs.flatMap((d) => d.rules || []);

  return (
    <div className="conflicts-panel policies-panel">
      <div className="panel-label">Company Policies</div>
      <p className="panel-sub">Rules governing Nexora's operational processes</p>
      {allRules.length === 0 && <div className="memory-empty">No policies uploaded yet.</div>}
      <div className="policy-cards">
        {docs.map((doc) => (
          <div key={doc.id} className="policy-doc-group">
            <div className="policy-doc-name">
              § {doc.filename.replace(/\.[^.]+$/, "").replace(/-/g, " ")}
            </div>
            {(doc.rules || []).map((rule) => {
              const isViolated = violatedIds.has(rule.id);
              return (
                <div key={rule.id} className={`policy-card-item${isViolated ? " policy-violated" : ""}`}>
                  {isViolated && <div className="policy-violated-tag">⚑ APPLIES</div>}
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

// ─── Verdict: compatible / warning / conflict, plus an LLM explanation ───
function VerdictBanner({ evaluation, triggerAiGlow }) {
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState("");

  useEffect(() => {
    setExplanation("");
    setExplainError("");
  }, [evaluation]);

  if (!evaluation?.status) return null;
  const { status, reasoning } = evaluation;
  const isConflict = status === "conflict";
  const isWarning = status === "warning";

  const handleExplain = async () => {
    triggerAiGlow?.();
    setExplaining(true);
    setExplainError("");
    try {
      const res = await api.explainEvaluation({
        proposal: evaluation.proposal,
        status: evaluation.status,
        origin_workflow: evaluation.origin_workflow,
        target_workflow: evaluation.target_workflow,
        skipped_workflows: evaluation.skipped_workflows,
        violated_rules: evaluation.violated_rules,
        reasoning: evaluation.reasoning,
      });
      setExplanation(res.explanation);
    } catch (e) {
      setExplainError(e.message);
    } finally {
      setExplaining(false);
    }
  };

  return (
    <>
      <div className={`verdict-banner${isConflict ? " verdict-conflict" : isWarning ? " verdict-warning" : " verdict-ok"}`}>
        <div className="verdict-icon">{isConflict ? "⛔" : isWarning ? "⚠" : "✓"}</div>
        <div className="verdict-content">
          <div className="verdict-title">
            {isConflict ? "CONFLICT DETECTED" : isWarning ? "WARNING — Process Deviation" : "WORKFLOW COMPATIBLE"}
          </div>
          <div className="verdict-reasoning">{reasoning}</div>
          {explanation && <div className="verdict-explanation">{explanation}</div>}
        </div>
        {!explanation && (
          <button className={`btn${isConflict ? " danger" : " secondary"} btn-sm`} onClick={handleExplain} disabled={explaining}>
            {explaining ? <><Spinner /> Explaining…</> : "✦ Explain"}
          </button>
        )}
      </div>
      {explainError && <ErrorNote message={explainError} />}
    </>
  );
}

// ─── Field-level conflicts against other live workflows ───
function ConflictsList({ conflicts, onFocusWorkflow }) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <div className="card" style={{ borderLeft: "4px solid #ef4444", background: "rgba(239, 68, 68, 0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: 16 }}>⛔</span>
        <strong style={{ color: "#991b1b", fontSize: 14 }}>
          {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} with live automations
        </strong>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {conflicts.map((c, ci) => (
          <div key={ci} style={{ borderTop: ci ? "1px solid #fecaca" : "none", paddingTop: ci ? 10 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#334155", lineHeight: 1.5 }}>{c.message}</div>
            {c.evidence?.field_paths?.length > 0 && (
              <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
                Colliding field paths: <code>{c.evidence.field_paths.join(", ")}</code>
              </div>
            )}
            {c.involved_workflows?.length > 0 && (
              <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Involved:</span>
                {c.involved_workflows.map((w, wi) => (
                  <span
                    key={wi}
                    onClick={() => onFocusWorkflow?.(w.id)}
                    style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 4, fontWeight: 600, color: "#334155", fontSize: 12, cursor: "pointer" }}
                  >
                    {w.name}
                  </span>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6 }}>
              <strong style={{ color: "#166534", fontSize: 11.5 }}>💡 Suggested fix: </strong>
              <span style={{ fontSize: 11.5, color: "#15803d" }}>
                {c.type === "direct_overwrite"
                  ? `Write to a scoped sub-key instead of colliding path '${c.evidence?.field_paths?.[0] || "properties"}', or add a guard condition.`
                  : c.type === "trigger_loop"
                  ? `Add a change-detection condition to break the cycle ${c.evidence?.cycle_path?.join(" → ") || ""}.`
                  : "Apply a validation rule to remove the overlap."}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SVS recommendation + decision buttons (simulate / direct / activate) ───
function DecisionPanel({ workflow, rec, recLoading, hasConflicts, simReport, simulating, onRunSim, onActivate, activateBusy }) {
  if (recLoading) {
    return (
      <div className="card" style={{ padding: 20, textAlign: "center" }}>
        <Spinner /> <span style={{ marginLeft: 8, color: "#64748b", fontSize: 13 }}>Computing SVS risk score…</span>
      </div>
    );
  }
  if (!rec) return null;

  const isDirect = rec.decision === "DIRECT" && !hasConflicts;
  const isDeep = rec.tier === "DEEP" || hasConflicts;
  const simPassed = simReport && (simReport.outcomes?.failed_or_terminated_early ?? simReport.failed_scenarios ?? 0) === 0;
  const simRan = !!simReport;

  const borderColor = simPassed ? "#10b981" : simRan ? "#ef4444" : isDirect ? "#10b981" : isDeep ? "#ef4444" : "#f59e0b";

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}`, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, color: borderColor, fontWeight: "bold" }}>
            {simPassed || isDirect ? "✓" : simRan || isDeep ? (simRan ? "⚠" : "⛔") : "⚡"}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#0f172a" }}>
            {simPassed
              ? "Verified in simulation"
              : simRan
              ? "Simulation found issues"
              : isDirect
              ? "Recommended: direct activation"
              : "Recommended: run simulation"}
          </span>
        </div>
        {rec.tier && !isDirect && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: isDeep ? "#fee2e2" : "#fef3c7", color: isDeep ? "#991b1b" : "#92400e" }}>
            SVS Tier: {isDeep ? "DEEP" : rec.tier}
          </span>
        )}
      </div>

      <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
        {hasConflicts
          ? "This workflow conflicts with live automations — resolve or review before activating."
          : rec.headline}
      </div>

      {(rec.factors || []).length > 0 && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {rec.factors.map((f, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "#64748b" }}>{f.label}</span>
              <span style={{ fontWeight: 600, color: "#1e293b" }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {simPassed ? (
          <button className="btn success btn-sm" onClick={onActivate} disabled={activateBusy || hasConflicts}
            title={hasConflicts ? "Resolve conflicts before pushing to automation" : ""}
          >
            {activateBusy ? <Spinner /> : "✓ Push to Automation"}
          </button>
        ) : (
          <>
            <button className="btn primary btn-sm" onClick={onRunSim} disabled={simulating}>
              {simulating ? <><Spinner /> Running…</> : `⚡ Run Simulation${rec.scenario_count ? ` (${rec.scenario_count} scenarios)` : ""}`}
            </button>
            {isDirect && !hasConflicts && (
              <button className="btn secondary btn-sm" onClick={onActivate} disabled={activateBusy}>
                {activateBusy ? <Spinner /> : "Skip simulation, push to automation"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Simulation({
  initialWorkflowId = null,
  pendingProposal = null,   // { proposal, evaluation, rawText } fresh off analyze
  onAdopted,
  onRejected,
  onNavigate,
  triggerAiGlow,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedWfId, setSelectedWfId] = useState(initialWorkflowId || pendingProposal?.proposal?.id || null);
  const [selectedDept, setSelectedDept] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedSteps, setSelectedSteps] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [evaluation, setEvaluation] = useState(pendingProposal?.evaluation || null);
  const [rawText, setRawText] = useState(pendingProposal?.rawText || "");
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [simulating, setSimulating] = useState(false);
  const [simReport, setSimReport] = useState(null);
  const [simCache, setSimCache] = useState({});
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [replayStepIdx, setReplayStepIdx] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activateBusy, setActivateBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rejected, setRejected] = useState(false);

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.listWorkflows(true);
      setWorkflows(res.workflows || []);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  // Fetch evaluation + recommendation + conflicts for whichever workflow is selected.
  const loadWorkflowContext = useCallback(async (wfId, knownEvaluation) => {
    if (!wfId) return;
    setRecLoading(true);
    setSimReport(simCache[wfId] || null);
    setActiveScenarioIdx(0);
    setReplayStepIdx(null);
    setIsPlaying(false);
    setRejected(false);
    try {
      const [evalRes, recRes, confRes, lastSim] = await Promise.all([
        knownEvaluation ? Promise.resolve(knownEvaluation) : api.evaluate(wfId).catch(() => null),
        api.getRecommendation(wfId).catch(() => null),
        api.getWorkflowConflicts(wfId).catch(() => ({ conflicts: [] })),
        simCache[wfId] ? Promise.resolve(null) : api.getLastSimulation(wfId).catch(() => null),
      ]);
      setEvaluation(evalRes);
      setRec(recRes);
      setConflicts(confRes.conflicts || []);
      if (lastSim && lastSim.workflow_id === wfId) {
        setSimCache((prev) => ({ ...prev, [wfId]: lastSim }));
        setSimReport(lastSim);
      }
    } finally {
      setRecLoading(false);
    }
  }, [simCache]);

  useEffect(() => {
    if (selectedWfId) {
      const usePending = pendingProposal?.proposal?.id === selectedWfId ? pendingProposal.evaluation : null;
      loadWorkflowContext(selectedWfId, usePending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWfId]);

  const handleSelectWorkflow = (wfId) => {
    setSelectedWfId(wfId);
    setRawText(pendingProposal?.proposal?.id === wfId ? pendingProposal.rawText : "");
  };

  const handleRunSimulation = async () => {
    if (!selectedWfId) return;
    triggerAiGlow?.();
    setSimulating(true);
    setError("");
    try {
      const data = await api.simulateWorkflow(selectedWfId);
      setSimCache((prev) => ({ ...prev, [selectedWfId]: data }));
      setSimReport(data);
      setActiveScenarioIdx(0);
    } catch (e) {
      setError(e.message || "Simulation run failed");
    } finally {
      setSimulating(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedWfId) return;
    triggerAiGlow?.();
    setActivateBusy(true);
    try {
      const originId = evaluation?.origin_workflow?.id || null;
      const adopted = await api.adoptWorkflow(selectedWfId, originId, null);
      await loadWorkflows();
      onAdopted?.(adopted.workflow);
    } catch (e) {
      setError(e.message || "Failed to activate workflow");
    } finally {
      setActivateBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selectedWfId) return;
    setActivateBusy(true);
    try {
      await api.rejectWorkflow(selectedWfId);
      setRejected(true);
      onRejected?.();
      await loadWorkflows();
      setSelectedWfId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setActivateBusy(false);
    }
  };

  const selectedWorkflow = workflows.find((w) => w.id === selectedWfId)
    || (pendingProposal?.proposal?.id === selectedWfId ? pendingProposal.proposal : null)
    || null;
  const isProposedSelection = selectedWorkflow?.status === "created" || selectedWorkflow?.status === "proposed" || selectedWorkflow?.is_proposed;

  const filteredWorkflows = workflows.filter((w) => {
    const matchesDept = selectedDept === "All" || w.department === selectedDept;
    const matchesQuery = !searchQuery
      || w.name.toLowerCase().includes(searchQuery.toLowerCase())
      || w.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "all" || (() => {
      if (selectedStatus === "review") return w.status === "review" || w.status === "needs_review";
      if (selectedStatus === "created") return w.status === "created" || (w.is_proposed && w.status !== "active");
      if (selectedStatus === "in_progress") return w.status === "in_progress" || w.status === "simulating";
      return w.status === selectedStatus;
    })();
    const stepCount = (w.steps || []).length;
    const matchesSteps = selectedSteps === "all"
      || (selectedSteps === "small" && stepCount <= 3)
      || (selectedSteps === "medium" && stepCount >= 4 && stepCount <= 6)
      || (selectedSteps === "large" && stepCount >= 7);
    return matchesDept && matchesQuery && matchesStatus && matchesSteps;
  });

  const failedCount = simReport ? (simReport.outcomes?.failed_or_terminated_early ?? simReport.failed_scenarios ?? 0) : 0;
  const isFullyVerified = simReport && failedCount === 0;
  const activeScenario = simReport?.scenarios?.[activeScenarioIdx] || null;
  const traceSteps = activeScenario?.trace || [];

  useEffect(() => {
    let timer;
    if (isPlaying && traceSteps.length > 0) {
      timer = setInterval(() => {
        setReplayStepIdx((prev) => {
          if (prev === null) return 0;
          if (prev >= traceSteps.length - 1) { setIsPlaying(false); return prev; }
          return prev + 1;
        });
      }, 700);
    }
    return () => clearInterval(timer);
  }, [isPlaying, traceSteps.length]);

  if (rejected) {
    return (
      <div className="conflicts-empty">
        <div className="empty-icon-lg" style={{ opacity: 0.5 }}>✕</div>
        <h3>Workflow Rejected</h3>
        <p>The proposed workflow was not added to process memory.</p>
        <button className="btn" onClick={() => onNavigate?.("dashboard")}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="simulation-page">
      <div className="sim-hero">
        <div className="sim-hero-left">
          <div className="sim-hero-badge"><span className="sim-pulse-dot" /> WORKFLOW REVIEW & SIMULATION</div>
          <h1>Process Simulation Studio</h1>
          <p>See how a workflow fits the existing process, what it conflicts with, and prove it against synthesized scenarios — all in one place.</p>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="sim-layout">
        <div className="sim-sidebar">
          <div className="sim-sidebar-head">
            <h3>Workflows</h3>
            <span className="sim-count-badge">{filteredWorkflows.length}</span>
          </div>
          <div className="sim-search-box">
            <input type="text" placeholder="Search workflows…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          {/* Status filter */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 0 2px" }}>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`dept-tab ${selectedStatus === opt.value ? "active" : ""}`}
                onClick={() => setSelectedStatus(opt.value)}
                style={{ fontSize: 11, padding: "3px 8px" }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Steps filter */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0 2px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.4px", whiteSpace: "nowrap" }}>Steps:</span>
            {STEPS_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`dept-tab ${selectedSteps === opt.value ? "active" : ""}`}
                onClick={() => setSelectedSteps(opt.value)}
                style={{ fontSize: 11, padding: "3px 8px" }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="dept-tabs">
            {DEPT_FILTER_OPTIONS.map((dept) => (
              <button key={dept} className={`dept-tab ${selectedDept === dept ? "active" : ""}`} onClick={() => setSelectedDept(dept)}>{dept}</button>
            ))}
          </div>
          <div className="sim-workflow-list">
            {loading && !workflows.length ? (
              <div className="sim-loading-box"><Spinner /></div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="sim-empty-state">No matching workflows</div>
            ) : (
              filteredWorkflows.map((w) => {
                const isSelected = w.id === selectedWfId;
                const isProposed = w.status === "created" || w.status === "proposed" || w.is_proposed;
                const isInProgress = w.status === "in_progress" || w.status === "simulating";
                const isReview = w.status === "review" || w.status === "needs_review";
                const isActive = w.status === "active" && !w.is_proposed;

                let statusBadge = null;
                if (isProposed && !isInProgress && !isReview) {
                  statusBadge = <span style={{ color: "#d97706", fontWeight: 700, fontSize: 10.5 }}>⚡ Created</span>;
                } else if (isInProgress) {
                  statusBadge = <span style={{ color: "#4338ca", fontWeight: 700, fontSize: 10.5 }}>⚡ In Progress</span>;
                } else if (isReview) {
                  statusBadge = <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 10.5 }}>⚠ Needs Review</span>;
                } else if (isActive) {
                  statusBadge = <span style={{ color: "#059669", fontWeight: 700, fontSize: 10.5 }}>✓ Active</span>;
                }

                return (
                  <div key={w.id} className={`sim-workflow-card ${isSelected ? "selected" : ""}`} onClick={() => handleSelectWorkflow(w.id)}>
                    <div className="sim-wf-top">
                      <strong className="sim-wf-name">{w.name}</strong>
                      <DepartmentBadge department={w.department} />
                    </div>
                    <div className="sim-wf-meta">
                      <span>{(w.steps || []).length} steps</span>
                      {statusBadge}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="sim-workspace">
          {!selectedWorkflow ? (
            <div className="sim-empty-stage">
              <p>Select a workflow from the left, or describe a new one from the Dashboard.</p>
            </div>
          ) : (
            <>
              <div className="sim-workspace-header">
                <div className="sim-ws-info">
                  <div className="sim-ws-title-row">
                    <h2>{selectedWorkflow.name}</h2>
                    <DepartmentBadge department={selectedWorkflow.department} />
                    {isProposedSelection && <span className="badge amber">Pending review</span>}
                  </div>
                  <p className="sim-ws-desc">{selectedWorkflow.description || "Configured multi-step workflow automation."}</p>
                  {rawText && <div className="proposed-quote" style={{ marginTop: 6 }}>"{rawText}"</div>}
                </div>
                {isProposedSelection && (
                  <button className="btn ghost btn-sm" onClick={handleReject} disabled={activateBusy}>
                    ✕ Reject
                  </button>
                )}
              </div>

              <MiniFlow steps={selectedWorkflow.steps} />

              {evaluation && (
                <>
                  <VerdictBanner evaluation={{ ...evaluation, proposal: selectedWorkflow }} triggerAiGlow={triggerAiGlow} />
                  <div className="conflicts-panels" style={{ marginTop: 16 }}>
                    <ProcessMemoryPanel evaluation={evaluation} />
                    <PoliciesPanel evaluation={evaluation} />
                  </div>
                </>
              )}

              <ConflictsList
                conflicts={conflicts}
                onFocusWorkflow={(wfId) => onNavigate?.("graph", wfId)}
              />

              <DecisionPanel
                workflow={selectedWorkflow}
                rec={rec}
                recLoading={recLoading}
                hasConflicts={conflicts.length > 0}
                simReport={simReport}
                simulating={simulating}
                onRunSim={handleRunSimulation}
                onActivate={handleActivate}
                activateBusy={activateBusy}
              />

              {simReport && (
                <div className="sim-results-space" style={{ marginTop: 16 }}>
                  <div className="sim-kpi-bar">
                    <div className="sim-kpi-box">
                      <div className="kpi-label">Simulation Success Rate</div>
                      <div className="kpi-value green">{simReport.outcomes?.success_rate_percent}%</div>
                      <div className="kpi-sub">{simReport.outcomes?.success} of {simReport.scenarios_run} scenarios passed</div>
                    </div>
                    <div className="sim-kpi-box">
                      <div className="kpi-label">Virtual Clock Execution</div>
                      <div className="kpi-value cyan">{simReport.total_virtual_duration_ms}ms</div>
                      <div className="kpi-sub">Elapsed virtual duration across runs</div>
                    </div>
                    <div className="sim-kpi-box">
                      <div className="kpi-label">Edge Injections Evaluated</div>
                      <div className="kpi-value purple">{simReport.scenarios?.length || 0} Tests</div>
                      <div className="kpi-sub">Nominal path + synthetic fault paths</div>
                    </div>
                    <div className="sim-kpi-box">
                      <div className="kpi-label">Anomaly & Early Terminations</div>
                      <div className="kpi-value amber">{simReport.terminated_early?.length || 0} Detected</div>
                    </div>
                  </div>

                  {!isFullyVerified && (
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderLeft: "4px solid #f59e0b", borderRadius: 8, padding: "16px 20px", margin: "16px 0" }}>
                      <strong style={{ color: "#0f172a", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>💡</span> Remediation Strategy
                      </strong>
                      <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                        <li>Add retry policies (exponential backoff, max 3 attempts) on external API connectors.</li>
                        <li>Ensure condition branches include explicit fallback routes for boundary inputs.</li>
                      </ul>
                    </div>
                  )}

                  <div className="sim-scenario-selector-card">
                    <div className="scenario-selector-head">
                      <h4>Select Simulation Scenario</h4>
                      <span className="pill-zero">Pure Python · 0 LLM</span>
                    </div>
                    <div className="scenario-tabs-row">
                      {(simReport.scenarios || []).map((sc, sIdx) => {
                        const isNominal = sIdx === 0;
                        return (
                          <button
                            key={sIdx}
                            className={`scenario-tab-card ${sIdx === activeScenarioIdx ? "active" : ""}`}
                            onClick={() => { setActiveScenarioIdx(sIdx); setReplayStepIdx(null); setIsPlaying(false); }}
                          >
                            <div className="scenario-tab-top">
                              <span className={`sc-badge ${isNominal ? "nominal" : "fault"}`}>
                                {isNominal ? "NOMINAL" : `FAULT INJECTION #${sIdx}`}
                              </span>
                              <span className="sc-duration">{sc.virtual_duration_ms}ms</span>
                            </div>
                            <div className="scenario-tab-title">{sc.scenario_name}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {activeScenario && (
                    <div className="sim-trace-canvas">
                      <div className="trace-canvas-header">
                        <div>
                          <h3>{activeScenario.scenario_name}</h3>
                          <p className="trace-subtitle">
                            Executed {activeScenario.step_count} step(s) in {activeScenario.virtual_duration_ms}ms virtual clock time.
                          </p>
                        </div>
                        <div className="replay-controls">
                          <button className="btn ghost btn-xs" onClick={() => { setReplayStepIdx((p) => (p === null ? 0 : Math.max(0, p - 1))); setIsPlaying(false); }}>⏮ Back</button>
                          <button className={`btn ${isPlaying ? "danger" : "secondary"} btn-xs`} onClick={() => setIsPlaying(!isPlaying)}>{isPlaying ? "⏸ Pause" : "▶ Live Replay"}</button>
                          <button className="btn ghost btn-xs" onClick={() => { setReplayStepIdx((p) => (p === null ? 0 : Math.min(traceSteps.length - 1, p + 1))); setIsPlaying(false); }}>Step Next ⏭</button>
                          <button className="btn ghost btn-xs" onClick={() => { setReplayStepIdx(null); setIsPlaying(false); }}>Reset</button>
                        </div>
                      </div>

                      {activeScenario.inputs && (
                        <div className="sim-inputs-summary">
                          <div className="inputs-summary-title"><span>🎲 Seeded Synthetic Data Inputs (Faker)</span></div>
                          <pre className="inputs-json">{JSON.stringify(activeScenario.inputs, null, 2)}</pre>
                        </div>
                      )}

                      <div className="trace-timeline-container">
                        {traceSteps.map((step, tIdx) => {
                          const isHighlighted = replayStepIdx === null || replayStepIdx >= tIdx;
                          const isCurrentReplay = replayStepIdx === tIdx;
                          const isTrigger = tIdx === 0;
                          return (
                            <div key={tIdx} className={`trace-timeline-node ${isHighlighted ? "active-node" : "dimmed-node"} ${isCurrentReplay ? "replay-current" : ""}`}>
                              <div className="trace-node-time"><span>⏱ +{step.virtual_time_ms}ms</span></div>
                              <div className="trace-node-line-anchor">
                                <div className={`trace-dot ${isTrigger ? "trigger-dot" : "action-dot"}`}>{isTrigger ? "⚡" : tIdx + 1}</div>
                                {tIdx < traceSteps.length - 1 && <div className="trace-stem" />}
                              </div>
                              <div className="trace-node-card">
                                <div className="trace-card-top">
                                  <div className="trace-card-title-group">
                                    <span className={`trace-kind-badge ${isTrigger ? "trigger-kind" : "action-kind"}`}>{isTrigger ? "TRIGGER" : `ACTION ${tIdx}`}</span>
                                    <span className="trace-step-name">{step.step_name}</span>
                                    <span className="trace-op-tag">{step.operation_id}</span>
                                  </div>
                                  <div className={`trace-status-pill ${step.status === "error" ? "error" : "success"}`}>
                                    {step.status === "error" ? "✕ ERROR" : `✓ ${step.status?.toUpperCase() || "OK"}`}
                                  </div>
                                </div>
                                {step.output?.error ? (
                                  <div className="trace-payload-block" style={{ borderLeft: "3px solid #ef4444", paddingLeft: 8, marginTop: 6 }}>
                                    <span className="payload-label" style={{ color: "#ef4444" }}>Simulated Exception / Error:</span>
                                    <pre className="payload-json" style={{ color: "#b91c1c", background: "#fef2f2", borderColor: "#fecaca" }}>{step.output.error}</pre>
                                  </div>
                                ) : step.output && (
                                  <div className="trace-payload-block">
                                    <span className="payload-label">Connector Output State:</span>
                                    <pre className="payload-json">{JSON.stringify(step.output, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
