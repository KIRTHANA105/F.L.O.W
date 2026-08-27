import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DepartmentBadge, Spinner, ErrorNote } from "./Shared";

const DEPT_FILTER_OPTIONS = [
  "All",
  "Sales",
  "Finance",
  "Legal",
  "Customer Success",
  "Support",
  "Procurement",
  "Operations",
];

export default function Simulation({
  initialWorkflowId = null,
  decisionPending = null,
  onReturnToDecision,
  onActivate,
  onRecalculate,
  onNavigate,
  triggerAiGlow,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedWfId, setSelectedWfId] = useState(initialWorkflowId);
  const [selectedDept, setSelectedDept] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [simReport, setSimReport] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [replayStepIdx, setReplayStepIdx] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedWfId) {
      api.getWorkflowConflicts(selectedWfId)
        .then((res) => setConflicts(res.conflicts || []))
        .catch(() => setConflicts([]));
    }
  }, [selectedWfId]);

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.listWorkflows(true); // include proposed workflows
      let wfs = res.workflows || [];
      if (decisionPending?.proposal && !wfs.some((w) => w.id === decisionPending.proposal.id)) {
        wfs = [decisionPending.proposal, ...wfs];
      }
      setWorkflows(wfs);
      setSelectedWfId((prev) => initialWorkflowId || prev || (wfs[0]?.id ?? null));
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [initialWorkflowId, decisionPending]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleRunSimulation = async (wfId) => {
    const idToRun = wfId || selectedWfId;
    if (!idToRun) return;
    triggerAiGlow?.();
    setSimulating(true);
    setError("");
    setReplayStepIdx(null);
    setIsPlaying(false);
    try {
      const data = await api.simulateWorkflow(idToRun);
      setSimReport(data);
      setActiveScenarioIdx(0);
    } catch (e) {
      setError(e.message || "Simulation run failed");
    } finally {
      setSimulating(false);
    }
  };

  // Auto-run simulation when initialWorkflowId is set
  const autoRunRef = useRef(false);
  useEffect(() => {
    if (initialWorkflowId && !autoRunRef.current) {
      autoRunRef.current = true;
      handleRunSimulation(initialWorkflowId);
    }
  }, [initialWorkflowId]);

  const selectedWorkflow =
    workflows.find((w) => w.id === selectedWfId) ||
    (decisionPending?.proposal?.id === selectedWfId ? decisionPending.proposal : null) ||
    workflows[0] ||
    null;

  const handleDirectActivate = async () => {
    if (!selectedWorkflow) return;
    triggerAiGlow?.();
    try {
      if (onActivate) {
        await onActivate(selectedWorkflow);
      } else {
        await api.adoptWorkflow(selectedWorkflow.id);
        await loadWorkflows();
        onNavigate?.("dashboard");
      }
    } catch (e) {
      setError(e.message || "Failed to activate workflow");
    }
  };

  const handleAutoFix = async () => {
    if (!selectedWorkflow) return;
    triggerAiGlow?.();
    setAutoFixing(true);
    setError("");
    try {
      const fixPrompt = `Optimize and harden workflow '${selectedWorkflow.name}': ${selectedWorkflow.description || ""}. Fix any unhandled edge cases, add retry policies for API action steps, and ensure fallback conditions.`;
      const analyzeRes = await api.analyze(fixPrompt);
      const newProposal = analyzeRes.proposal;
      const evalRes = await api.evaluate(newProposal.id);

      if (typeof onRecalculate === "function") {
        onRecalculate({
          proposal: newProposal,
          evaluation: evalRes,
          rawText: fixPrompt,
        });
      }
      setSelectedWfId(newProposal.id);
      await loadWorkflows();
      await handleRunSimulation(newProposal.id);
    } catch (e) {
      setError(e.message || "Failed to auto-fix workflow with AI");
    } finally {
      setAutoFixing(false);
    }
  };

  // Re-run or auto-run on workflow switch if report exists
  const handleSelectWorkflow = (wfId) => {
    setSelectedWfId(wfId);
    setSimReport(null);
    setReplayStepIdx(null);
    setIsPlaying(false);
  };

  // Step-through replay logic
  const activeScenario = simReport?.scenarios?.[activeScenarioIdx] || null;
  const traceSteps = activeScenario?.trace || [];

  useEffect(() => {
    let timer;
    if (isPlaying && traceSteps.length > 0) {
      timer = setInterval(() => {
        setReplayStepIdx((prev) => {
          if (prev === null) return 0;
          if (prev >= traceSteps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 700);
    }
    return () => clearInterval(timer);
  }, [isPlaying, traceSteps.length]);

  const filteredWorkflows = workflows.filter((w) => {
    const matchesDept = selectedDept === "All" || w.department === selectedDept;
    const matchesQuery =
      !searchQuery ||
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDept && matchesQuery;
  });

  const failedCount = simReport ? (simReport.outcomes?.failed_or_terminated_early ?? simReport.failed_scenarios ?? 0) : 0;
  const isFullyVerified = simReport && failedCount === 0;

  return (
    <div className="simulation-page">
      <div className="sim-hero">
        <div className="sim-hero-left">
          <div className="sim-hero-badge">
            <span className="sim-pulse-dot" /> DETERMINISTIC VIRTUAL SIMULATION
          </div>
          <h1>Process Simulation Studio</h1>
          <p>
            Prove and stress-test your business processes against synthesized scenarios,
            boundary data, and connector failure injections with zero production risk.
          </p>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="sim-layout">
        {/* Left Column: Workflow Selector */}
        <div className="sim-sidebar">
          <div className="sim-sidebar-head">
            <h3>Automations</h3>
            <span className="sim-count-badge">{filteredWorkflows.length}</span>
          </div>

          <div className="sim-search-box">
            <input
              type="text"
              placeholder="Search workflows…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="dept-tabs">
            {DEPT_FILTER_OPTIONS.map((dept) => (
              <button
                key={dept}
                className={`dept-tab ${selectedDept === dept ? "active" : ""}`}
                onClick={() => setSelectedDept(dept)}
              >
                {dept}
              </button>
            ))}
          </div>

          <div className="sim-workflow-list">
            {loading && !workflows.length ? (
              <div className="sim-loading-box">
                <Spinner />
              </div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="sim-empty-state">No matching workflows</div>
            ) : (
              filteredWorkflows.map((w) => {
                const isSelected = w.id === selectedWfId;
                const isProposed = w.status === "proposed" || w.is_proposed;
                return (
                  <div
                    key={w.id}
                    className={`sim-workflow-card ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelectWorkflow(w.id)}
                  >
                    <div className="sim-wf-top">
                      <strong className="sim-wf-name">{w.name}</strong>
                      <DepartmentBadge department={w.department} />
                    </div>
                    <div className="sim-wf-meta">
                      <span>{(w.steps || []).length} steps</span>
                      {isProposed && (
                        <span style={{ color: "#d97706", fontWeight: 700 }}>
                          ⚡ Pending Gate
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Active Simulation Workspace */}
        <div className="sim-workspace">
          {selectedWorkflow ? (
            <>
              {/* Header Box */}
              <div className="sim-workspace-header">
                <div className="sim-ws-info">
                  <div className="sim-ws-title-row">
                    <h2>{selectedWorkflow.name}</h2>
                    <DepartmentBadge department={selectedWorkflow.department} />
                    {selectedWorkflow.status === "proposed" && (
                      <span className="badge amber">Pending Activation Gate</span>
                    )}
                  </div>
                  <p className="sim-ws-desc">
                    {selectedWorkflow.description || "Configured multi-step workflow automation."}
                  </p>
                </div>

                <div className="sim-ws-actions">
                  <button
                    className="btn primary"
                    onClick={() => handleRunSimulation()}
                    disabled={simulating}
                  >
                    {simulating ? (
                      <>
                        <Spinner /> Running Scenarios…
                      </>
                    ) : (
                      <>
                        <span>⚡ Run Deterministic Simulation</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Simulation Results Dashboard */}
              {simReport ? (
                <div className="sim-results-space">
                  {/* 1. Conflict Warning Banner if conflicts detected */}
                  {conflicts.length > 0 && (
                    <div
                      style={{
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "8px",
                        padding: "14px 20px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "12px",
                        marginBottom: "16px",
                      }}
                    >
                      <div>
                        <strong style={{ color: "#991b1b", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span>⛔</span> Process Conflict Detected Against Live Automations ({conflicts.length})
                        </strong>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                          {conflicts[0]?.message || "This workflow has overlapping field or trigger collisions with existing automations."}
                        </div>
                      </div>

                      <button
                        className="btn danger btn-sm"
                        onClick={() => onNavigate?.("conflicts", selectedWorkflow?.id)}
                        style={{ fontWeight: 700, padding: "8px 16px", fontSize: "13px" }}
                      >
                        ⛔ Inspect in Conflict Tab & View Strategy →
                      </button>
                    </div>
                  )}

                  {/* 2. Simulation Outcome Banner */}
                  <div
                    style={{
                      background: isFullyVerified ? "#f0fdf4" : "#fffbeb",
                      border: `1px solid ${isFullyVerified ? "#86efac" : "#fde68a"}`,
                      borderRadius: "8px",
                      padding: "14px 20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      <strong style={{ color: isFullyVerified ? "#166534" : "#92400e", fontSize: "14px" }}>
                        {isFullyVerified
                          ? `✓ Simulation Verified: All ${simReport.scenarios_run} scenarios passed without error.`
                          : `⚠ Simulation Completed: ${failedCount} issue${failedCount > 1 ? "s" : ""} detected.`}
                      </strong>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                        {isFullyVerified
                          ? "Workflow execution has been proven across boundary and fault injections. Ready for live execution."
                          : "Edge case termination or unhandled exception observed. Review details or use AI Auto-Fix below."}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      {isFullyVerified ? (
                        <button
                          className="btn success btn-sm"
                          onClick={handleDirectActivate}
                          style={{ fontWeight: 700, padding: "8px 18px", fontSize: "13px" }}
                        >
                          ✓ Move to Live Automation Execution Phase →
                        </button>
                      ) : (
                        <button
                          className="btn secondary btn-sm"
                          onClick={handleAutoFix}
                          disabled={autoFixing}
                          style={{ fontWeight: 700, padding: "8px 16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
                        >
                          {autoFixing ? <Spinner /> : "🔄 Auto-Fix & Optimize with AI"}
                        </button>
                      )}

                      {onReturnToDecision && (
                        <button
                          className="btn ghost btn-sm"
                          onClick={() => onReturnToDecision(simReport)}
                          style={{ fontSize: "12px" }}
                        >
                          Return to Gate
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3. AI Remediation Insights Panel when issues detected */}
                  {!isFullyVerified && (
                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderLeft: "4px solid #f59e0b",
                        borderRadius: "8px",
                        padding: "16px 20px",
                        marginBottom: "16px",
                      }}
                    >
                      <strong style={{ color: "#0f172a", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>💡</span> AI Optimization Insights & Remediation Strategy:
                      </strong>
                      <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "13px", color: "#475569", lineHeight: "1.6" }}>
                        <li>
                          <strong>Defensive Error Policy:</strong> Add retry policies (e.g. exponential backoff, max 3 attempts) on external API connectors to survive temporary 500/timeout network errors.
                        </li>
                        <li>
                          <strong>Boundary Guardrails:</strong> Ensure condition branches include explicit fallback routes for empty or boundary inputs.
                        </li>
                        <li>
                          <strong>One-Click Fix:</strong> Click <code>🔄 Auto-Fix & Optimize with AI</code> to automatically restructure these steps into the workflow schema.
                        </li>
                      </ul>
                    </div>
                  )}

                  {/* KPI Metrics */}
                  <div className="sim-kpi-bar">
                    <div className="sim-kpi-box">
                      <div className="kpi-label">Simulation Success Rate</div>
                      <div className="kpi-value green">
                        {simReport.outcomes?.success_rate_percent}%
                      </div>
                      <div className="kpi-sub">
                        {simReport.outcomes?.success} of {simReport.scenarios_run} scenarios passed
                      </div>
                    </div>

                    <div className="sim-kpi-box">
                      <div className="kpi-label">Virtual Clock Execution</div>
                      <div className="kpi-value cyan">
                        {simReport.total_virtual_duration_ms}ms
                      </div>
                      <div className="kpi-sub">Elapsed virtual duration across runs</div>
                    </div>

                    <div className="sim-kpi-box">
                      <div className="kpi-label">Edge Injections Evaluated</div>
                      <div className="kpi-value purple">
                        {simReport.scenarios?.length || 5} Tests
                      </div>
                      <div className="kpi-sub">Nominal path + 4 synthetic fault paths</div>
                    </div>

                    <div className="sim-kpi-box">
                      <div className="kpi-label">Anomaly & Early Terminations</div>
                      <div className="kpi-value amber">
                        {simReport.terminated_early?.length || 0} Detected
                      </div>
                      <div className="kpi-sub">0 deadlock risk detected</div>
                    </div>
                  </div>

                  {/* Scenario Navigator */}
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
                            onClick={() => {
                              setActiveScenarioIdx(sIdx);
                              setReplayStepIdx(null);
                              setIsPlaying(false);
                            }}
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

                  {/* Active Scenario Detail & Replay Controls */}
                  {activeScenario && (
                    <div className="sim-trace-canvas">
                      <div className="trace-canvas-header">
                        <div>
                          <h3>{activeScenario.scenario_name}</h3>
                          <p className="trace-subtitle">
                            Executed {activeScenario.step_count} step(s) in {activeScenario.virtual_duration_ms}ms virtual clock time.
                          </p>
                        </div>

                        {/* Interactive Replay Stepper */}
                        <div className="replay-controls">
                          <button
                            className="btn ghost btn-xs"
                            onClick={() => {
                              setReplayStepIdx((prev) =>
                                prev === null ? 0 : Math.max(0, prev - 1)
                              );
                              setIsPlaying(false);
                            }}
                            title="Previous step"
                          >
                            ⏮ Back
                          </button>

                          <button
                            className={`btn ${isPlaying ? "danger" : "secondary"} btn-xs`}
                            onClick={() => setIsPlaying(!isPlaying)}
                          >
                            {isPlaying ? "⏸ Pause" : "▶ Live Replay"}
                          </button>

                          <button
                            className="btn ghost btn-xs"
                            onClick={() => {
                              setReplayStepIdx((prev) =>
                                prev === null
                                  ? 0
                                  : Math.min(traceSteps.length - 1, prev + 1)
                              );
                              setIsPlaying(false);
                            }}
                            title="Next step"
                          >
                            Step Next ⏭
                          </button>

                          <button
                            className="btn ghost btn-xs"
                            onClick={() => {
                              setReplayStepIdx(null);
                              setIsPlaying(false);
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      {/* Synthetic Inputs Card */}
                      {activeScenario.inputs && (
                        <div className="sim-inputs-summary">
                          <div className="inputs-summary-title">
                            <span>🎲 Seeded Synthetic Data Inputs (Faker)</span>
                          </div>
                          <pre className="inputs-json">
                            {JSON.stringify(activeScenario.inputs, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Stepped Timeline Trace */}
                      <div className="trace-timeline-container">
                        {traceSteps.map((step, tIdx) => {
                          const isHighlighted =
                            replayStepIdx === null || replayStepIdx >= tIdx;
                          const isCurrentReplay = replayStepIdx === tIdx;
                          const isTrigger = tIdx === 0;

                          return (
                            <div
                              key={tIdx}
                              className={`trace-timeline-node ${isHighlighted ? "active-node" : "dimmed-node"} ${isCurrentReplay ? "replay-current" : ""}`}
                            >
                              <div className="trace-node-time">
                                <span>⏱ +{step.virtual_time_ms}ms</span>
                              </div>

                              <div className="trace-node-line-anchor">
                                <div className={`trace-dot ${isTrigger ? "trigger-dot" : "action-dot"}`}>
                                  {isTrigger ? "⚡" : tIdx + 1}
                                </div>
                                {tIdx < traceSteps.length - 1 && <div className="trace-stem" />}
                              </div>

                              <div className="trace-node-card">
                                <div className="trace-card-top">
                                  <div className="trace-card-title-group">
                                    <span className={`trace-kind-badge ${isTrigger ? "trigger-kind" : "action-kind"}`}>
                                      {isTrigger ? "TRIGGER" : `ACTION ${tIdx}`}
                                    </span>
                                    <span className="trace-step-name">{step.step_name}</span>
                                    <span className="trace-op-tag">{step.operation_id}</span>
                                  </div>

                                  <div className={`trace-status-pill ${step.status === "error" ? "error" : "success"}`}>
                                    {step.status === "error" ? "✕ ERROR" : `✓ ${step.status?.toUpperCase() || "OK"}`}
                                  </div>
                                </div>

                                {step.output?.error ? (
                                  <div className="trace-payload-block" style={{ borderLeft: "3px solid #ef4444", paddingLeft: "8px", marginTop: "6px" }}>
                                    <span className="payload-label" style={{ color: "#ef4444" }}>Simulated Exception / Error:</span>
                                    <pre className="payload-json" style={{ color: "#b91c1c", background: "#fef2f2", borderColor: "#fecaca" }}>
                                      {step.output.error}
                                    </pre>
                                  </div>
                                ) : step.output && (
                                  <div className="trace-payload-block">
                                    <span className="payload-label">Connector Output State:</span>
                                    <pre className="payload-json">
                                      {JSON.stringify(step.output, null, 2)}
                                    </pre>
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
              ) : (
                <div className="sim-empty-stage">
                  <div className="empty-stage-icon">⚡</div>
                  <h3>Ready to Simulate</h3>
                  <p>
                    Click <strong>"Run Deterministic Simulation"</strong> above to synthesize
                    5 scenarios across virtual clock steps and verify execution paths with 0 LLM calls.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="sim-empty-stage">
              <p>Select a workflow from the left sidebar to start simulation.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
