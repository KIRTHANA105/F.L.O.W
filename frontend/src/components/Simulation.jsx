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
  triggerAiGlow,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedWfId, setSelectedWfId] = useState(initialWorkflowId);
  const [selectedDept, setSelectedDept] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simReport, setSimReport] = useState(null);
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [replayStepIdx, setReplayStepIdx] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.listWorkflows(true); // include proposed workflows
      let wfs = res.workflows || [];
      if (decisionPending?.proposal && !wfs.some((w) => w.id === decisionPending.proposal.id)) {
        wfs = [decisionPending.proposal, ...wfs];
      }
      setWorkflows(wfs);
      const targetId = initialWorkflowId || selectedWfId || (wfs[0]?.id ?? null);
      if (targetId) {
        setSelectedWfId(targetId);
      }
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [selectedWfId, initialWorkflowId, decisionPending]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

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
            virtual clock time steps, and connector fault injection before deploying to production.
          </p>
        </div>

        <div className="sim-hero-stats">
          <div className="hero-stat-card">
            <span className="hero-stat-num">0</span>
            <span className="hero-stat-label">LLM Quota Used</span>
          </div>
          <div className="hero-stat-card">
            <span className="hero-stat-num">100%</span>
            <span className="hero-stat-label">Deterministic Python</span>
          </div>
          <div className="hero-stat-card">
            <span className="hero-stat-num">Instant</span>
            <span className="hero-stat-label">Virtual Clock ms</span>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />

      <div className="sim-studio-grid">
        {/* Left Column: Workflow Selector */}
        <div className="sim-sidebar">
          <div className="sim-sidebar-header">
            <h3>Workflows</h3>
            <span className="sim-wf-count">{filteredWorkflows.length}</span>
          </div>

          <div className="sim-search-bar">
            <input
              type="text"
              placeholder="Search workflows…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="sim-dept-filter-pills">
            {DEPT_FILTER_OPTIONS.map((dept) => (
              <button
                key={dept}
                className={`sim-dept-btn ${selectedDept === dept ? "active" : ""}`}
                onClick={() => setSelectedDept(dept)}
              >
                {dept}
              </button>
            ))}
          </div>

          <div className="sim-wf-list">
            {loading ? (
              <div className="sim-loading-wrap">
                <Spinner /> Loading workflows…
              </div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="sim-empty-list">No workflows found.</div>
            ) : (
              filteredWorkflows.map((wf) => (
                <div
                  key={wf.id}
                  className={`sim-wf-card ${wf.id === selectedWfId ? "active" : ""}`}
                  onClick={() => handleSelectWorkflow(wf.id)}
                >
                  <div className="sim-wf-top">
                    <DepartmentBadge department={wf.department} />
                    <span className="sim-step-badge">
                      {wf.steps?.length || 0} steps
                    </span>
                  </div>
                  <div className="sim-wf-name">{wf.name}</div>
                  <div className="sim-wf-desc">{wf.description}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Interactive Simulation Console & Visual Trace */}
        <div className="sim-main-stage">
          {selectedWorkflow ? (
            <div className="sim-active-workflow-panel">
              <div className="sim-control-banner">
                <div>
                  <div className="sim-active-dept">
                    <DepartmentBadge department={selectedWorkflow.department} />
                    <span className="sim-arch-indicator">
                      ⚡ 1 Trigger · ⚙ {Math.max(0, (selectedWorkflow.steps?.length || 1) - 1)} Actions
                    </span>
                  </div>
                  <h2 className="sim-active-title">{selectedWorkflow.name}</h2>
                  <p className="sim-active-desc">{selectedWorkflow.description}</p>
                </div>

                <div className="sim-action-group">
                  <button
                    className="btn primary sim-run-btn"
                    onClick={() => handleRunSimulation()}
                    disabled={simulating}
                  >
                    {simulating ? (
                      <>
                        <Spinner /> Running 5 Scenarios…
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
                  {onReturnToDecision && (
                    <div
                      style={{
                        background: simReport.failed_scenarios === 0 ? "#f0fdf4" : "#fffbeb",
                        border: `1px solid ${simReport.failed_scenarios === 0 ? "#86efac" : "#fde68a"}`,
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
                        <strong style={{ color: simReport.failed_scenarios === 0 ? "#166534" : "#92400e", fontSize: "14px" }}>
                          {simReport.failed_scenarios === 0
                            ? `✓ Simulation Verified: ${simReport.scenarios_run} scenarios passed without error.`
                            : `⚠ Simulation Completed: ${simReport.failed_scenarios} issues detected.`}
                        </strong>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                          {simReport.failed_scenarios === 0
                            ? "Workflow behavior is verified. Click below to proceed to the live automation activation phase."
                            : "Issues detected during simulation. Review trace steps or return to Decision Gate."}
                        </div>
                      </div>

                      <button
                        className="btn success btn-sm"
                        onClick={() => onReturnToDecision(simReport)}
                        style={{ fontWeight: 700, padding: "8px 16px", fontSize: "13px" }}
                      >
                        ✓ Return to Decision Gate & Proceed to Activation →
                      </button>
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

                                  <div className="trace-status-pill success">
                                    ✓ {step.status?.toUpperCase() || "OK"}
                                  </div>
                                </div>

                                {step.output && (
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
            </div>
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
