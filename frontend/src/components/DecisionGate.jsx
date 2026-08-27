import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DepartmentBadge, Spinner, ErrorNote } from "./Shared";
import CreateWorkflowModal from "./CreateWorkflowModal";

/**
 * Activation Decision Gate (SVS Gate Screen)
 * The mandatory decision screen before activating any generated workflow.
 */
export default function DecisionGate({
  pending,          // { proposal, evaluation, rawText }
  lastSimReport,    // Simulation report if simulation just ran
  onActivate,       // (proposal, overrideLog) => void
  onSimulate,       // (workflowId, scenarioCount) => void
  onReject,         // () => void
  onRecalculate,    // (result) => void
  onNavigate,       // (tab, wfId) => void
  triggerAiGlow,
}) {
  const proposal = pending?.proposal;
  const rawText = pending?.rawText || "";
  const workflowId = proposal?.id;

  const [rec, setRec] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [error, setError] = useState("");
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const handleRecalculate = async () => {
    triggerAiGlow?.();
    setRecalculating(true);
    setError("");
    try {
      const promptText = rawText || `${proposal?.name}: ${proposal?.description}`;
      const analyzeRes = await api.analyze(promptText);
      const newProposal = analyzeRes.proposal;
      const evalRes = await api.evaluate(newProposal.id);

      if (typeof onRecalculate === "function") {
        onRecalculate({
          proposal: newProposal,
          evaluation: evalRes,
          rawText: promptText,
        });
      }
      if (workflowId && workflowId !== newProposal.id) {
        api.rejectWorkflow(workflowId).catch(() => {});
      }
    } catch (e) {
      setError(e.message || "Failed to recalculate workflow with AI");
    } finally {
      setRecalculating(false);
    }
  };

  const fetchRecommendation = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const [recData, confData] = await Promise.all([
        api.getRecommendation(workflowId),
        api.getWorkflowConflicts(workflowId).catch(() => ({ conflicts: [] })),
      ]);
      setRec(recData);
      setConflicts(confData.conflicts || []);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to calculate decision gate recommendation");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchRecommendation();
  }, [fetchRecommendation]);

  const handleRunSim = () => {
    triggerAiGlow?.();
    const count = rec?.scenario_count || 12;
    onSimulate?.(workflowId, count);
  };

  const handleDirectActivate = async (isOverride = false) => {
    triggerAiGlow?.();
    setActionBusy(true);
    let overrideEntry = null;
    if (isOverride && rec) {
      overrideEntry = {
        workflow_id: workflowId,
        name: proposal.name,
        timestamp: new Date().toISOString(),
        reason_code: rec.reason_code,
        factor: (rec.factors || [])[0]?.value || "Unverified risk factor",
      };
      // Persist in localStorage for audit history
      try {
        const prev = JSON.parse(localStorage.getItem("flow_override_logs") || "[]");
        localStorage.setItem("flow_override_logs", JSON.stringify([overrideEntry, ...prev]));
      } catch (err) {
        console.error("Failed to persist override log", err);
      }
    }

    try {
      await onActivate?.(proposal, overrideEntry);
    } finally {
      setActionBusy(false);
    }
  };

  if (!proposal) {
    return (
      <div className="conflicts-empty">
        <div className="empty-icon-lg">⟳</div>
        <h3>No workflow pending decision</h3>
        <p>Use the <strong>+ New Workflow</strong> button to generate an automation.</p>
        <button className="btn" onClick={() => onNavigate?.("dashboard")}>
          Go to Dashboard
        </button>
      </div>
    );
  }

  const steps = proposal.steps || [];
  const triggerStep = steps[0]?.name || "Trigger Event";
  const actionSteps = steps.slice(1);

  // Check simulation status
  const simPassed = lastSimReport && lastSimReport.failed_scenarios === 0;
  const simFailed = lastSimReport && lastSimReport.failed_scenarios > 0;

  const isDirect = rec?.decision === "DIRECT";
  const isDeep = rec?.tier === "DEEP";
  const isStandard = rec?.tier === "STANDARD";

  const topFactor = (rec?.factors || [])[0] || { label: "Risk factor", value: "State modifications" };

  const cardBorder = simPassed
    ? "2px solid #10b981"
    : simFailed
    ? "2px solid #ef4444"
    : isDirect
    ? "2px solid #10b981"
    : isDeep
    ? "2px solid #ef4444"
    : "2px solid #f59e0b";

  return (
    <div className="decision-gate-page" style={{ maxWidth: "980px", margin: "0 auto", padding: "8px 16px 32px 16px", display: "flex", flexDirection: "column", gap: "20px" }}>
      
      {/* Screen Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: "14px" }}>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#6366f1", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "4px" }}>
            Step 2 of 2 · Verification & Activation Gate
          </div>
          <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Activation Decision Gate
          </h2>
          <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>
            Deterministic risk evaluation computed from connector capabilities and live process memory.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button
            className="btn secondary btn-sm"
            onClick={handleRecalculate}
            disabled={actionBusy || recalculating}
            style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600 }}
            title="Instantly re-analyze and regenerate this workflow with AI"
          >
            {recalculating ? <Spinner /> : "🔄 Recalculate with AI"}
          </button>
          <button
            className="btn secondary btn-sm"
            onClick={() => setShowEditModal(true)}
            disabled={actionBusy || recalculating}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            title="Edit prompt and recalculate with AI"
          >
            ✏ Edit Prompt
          </button>
          <button
            className="btn ghost btn-sm"
            onClick={onReject}
            disabled={actionBusy || recalculating}
            style={{ color: "#64748b" }}
          >
            ✕ Discard
          </button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      {/* 1. Workflow Summary Box */}
      <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", background: "#ffffff", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
              {proposal.name}
            </h3>
            <DepartmentBadge department={proposal.department} />
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>

        {rawText && (
          <div style={{ fontSize: "13px", color: "#475569", fontStyle: "italic", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", borderLeft: "3px solid #cbd5e1" }}>
            "{rawText}"
          </div>
        )}

        {/* Step Flow Thumbnail */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, padding: "4px 10px", background: "#eef2ff", color: "#4338ca", borderRadius: "6px", border: "1px solid #c7d2fe" }}>
            ⚡ {triggerStep}
          </div>
          {actionSteps.map((s, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>→</span>
              <div style={{ fontSize: "12px", padding: "4px 10px", background: "#f1f5f9", color: "#334155", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                {s.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Inline Process Conflict Alert (if detected) */}
      {conflicts.length > 0 && (
        <div
          className="card"
          style={{
            borderLeft: "4px solid #ef4444",
            background: "rgba(239, 68, 68, 0.04)",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "16px" }}>⛔</span>
            <strong style={{ color: "#991b1b", fontSize: "14px" }}>
              Process Conflict Detected Against Live Automations
            </strong>
          </div>
          {conflicts.map((c, ci) => (
            <div key={ci} style={{ fontSize: "13px", color: "#334155", lineHeight: "1.5" }}>
              <div>{c.message}</div>
              {c.evidence?.field_paths?.length > 0 && (
                <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>
                  Colliding field paths: <code>{c.evidence.field_paths.join(", ")}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 2. Decision Card Box */}
      {loading ? (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <Spinner />
          <p style={{ marginTop: "12px", color: "#64748b", fontSize: "14px" }}>
            Evaluating SVS risk score & catalog side effects…
          </p>
        </div>
      ) : (
        <div
          className="card"
          style={{
            padding: "24px",
            borderLeft: cardBorder,
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            background: simPassed
              ? "rgba(16, 185, 129, 0.03)"
              : simFailed
              ? "rgba(239, 68, 68, 0.03)"
              : isDirect
              ? "rgba(16, 185, 129, 0.03)"
              : isDeep
              ? "rgba(239, 68, 68, 0.03)"
              : "rgba(245, 158, 11, 0.03)",
          }}
        >
          {/* Header Banner */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  fontSize: "18px",
                  color: simPassed || isDirect ? "#10b981" : isDeep || simFailed ? "#ef4444" : "#d97706",
                  fontWeight: "bold",
                }}
              >
                {simPassed ? "✓" : isDirect ? "✓" : "⚠"}
              </span>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 800,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  color: simPassed || isDirect ? "#065f46" : isDeep || simFailed ? "#991b1b" : "#92400e",
                }}
              >
                {simPassed
                  ? "VERIFIED IN SIMULATION"
                  : simFailed
                  ? "SIMULATION FAILED — ISSUES DETECTED"
                  : isDirect
                  ? "RECOMMENDED: DIRECT ACTIVATION"
                  : isDeep
                  ? "RECOMMENDED: FULL SIMULATION (DEEP)"
                  : isStandard
                  ? "RECOMMENDED: STANDARD SIMULATION"
                  : "RECOMMENDED: SHALLOW SIMULATION"}
              </span>
            </div>

            {rec?.tier && !isDirect && !simPassed && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "20px",
                  background: isDeep ? "#fee2e2" : "#fef3c7",
                  color: isDeep ? "#991b1b" : "#92400e",
                }}
              >
                SVS Tier: {rec.tier}
              </span>
            )}
          </div>

          {/* Headline Text */}
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b", lineHeight: "1.5" }}>
            {simPassed
              ? `All ${lastSimReport.total_scenarios} test scenarios passed across edge conditions, latencies, and variable scopes.`
              : simFailed
              ? `${lastSimReport.failed_scenarios} of ${lastSimReport.total_scenarios} scenarios failed during test execution.`
              : rec?.headline}
          </div>

          {/* 4 Factor Rows */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {(rec?.factors || []).map((f, idx) => {
              const dotColor =
                f.level === "high"
                  ? "#ef4444"
                  : f.level === "medium"
                  ? "#f59e0b"
                  : "#10b981";

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "13px",
                    paddingBottom: idx !== rec.factors.length - 1 ? "8px" : "0",
                    borderBottom: idx !== rec.factors.length - 1 ? "1px solid #f1f5f9" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: dotColor,
                        display: "inline-block",
                      }}
                    />
                    <span style={{ color: "#64748b" }}>{f.label}</span>
                  </div>

                  <span style={{ fontWeight: 600, color: "#1e293b" }}>
                    {f.value}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Scenario Count & Time Meta */}
          {!isDirect && !simPassed && rec?.scenario_count > 0 && (
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              ⚡ <strong>{rec.scenario_count} test scenarios</strong> · about {rec.estimated_seconds} second{rec.estimated_seconds !== 1 ? "s" : ""}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "4px" }}>
            {simPassed ? (
              <>
                <button
                  className="btn success btn-sm"
                  onClick={() => handleDirectActivate(false)}
                  disabled={actionBusy}
                  style={{ padding: "9px 20px", fontSize: "14px", fontWeight: 600 }}
                >
                  {actionBusy ? <Spinner /> : "✓ Activate Workflow"}
                </button>
                <button
                  className="btn secondary btn-sm"
                  onClick={handleRunSim}
                  disabled={actionBusy}
                >
                  Re-run Simulation
                </button>
              </>
            ) : simFailed ? (
              <>
                <button
                  className="btn primary btn-sm"
                  onClick={handleRunSim}
                  disabled={actionBusy}
                >
                  Fix Issues in Simulation
                </button>
                <button
                  className="btn-text-subtle"
                  onClick={() => setShowOverrideModal(true)}
                  disabled={actionBusy}
                  style={{ fontSize: "13px", color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  Activate anyway
                </button>
              </>
            ) : isDirect ? (
              <>
                <button
                  className="btn success btn-sm"
                  onClick={() => handleDirectActivate(false)}
                  disabled={actionBusy}
                  style={{ padding: "9px 20px", fontSize: "14px", fontWeight: 600 }}
                >
                  {actionBusy ? <Spinner /> : "✓ Put in Live Execution Phase"}
                </button>
                <button
                  className="btn secondary btn-sm"
                  onClick={handleRunSim}
                  disabled={actionBusy}
                >
                  Simulate anyway
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn primary btn-sm"
                  onClick={handleRunSim}
                  disabled={actionBusy}
                  style={{ padding: "9px 20px", fontSize: "14px", fontWeight: 600 }}
                >
                  ⚡ Proceed to Simulation Phase
                </button>
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(true)}
                  disabled={actionBusy}
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: "4px 8px",
                  }}
                >
                  Activate without simulating
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Override Confirm Dialog */}
      {showOverrideModal && (
        <div className="modal-backdrop" onClick={() => setShowOverrideModal(false)}>
          <div
            className="modal-panel"
            style={{ maxWidth: "460px", padding: "24px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "20px", color: "#f59e0b" }}>⚠</span>
              <h3 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                Skip Recommended Simulation?
              </h3>
            </div>

            <div style={{ fontSize: "14px", color: "#475569", lineHeight: "1.5", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 12px 0" }}>
                You're skipping verification on a workflow that{" "}
                <strong>{topFactor.value.toLowerCase()}</strong>.
              </p>
              <div style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: "10px 12px", borderRadius: "6px", color: "#92400e", fontSize: "13px" }}>
                <strong>Risk factor:</strong> {topFactor.label} ({topFactor.value})
              </div>
              <p style={{ margin: "12px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                This override will be logged in system audit history with timestamp. Continue?
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                className="btn ghost btn-sm"
                onClick={() => setShowOverrideModal(false)}
              >
                Cancel & Verify
              </button>
              <button
                className="btn danger btn-sm"
                onClick={() => {
                  setShowOverrideModal(false);
                  handleDirectActivate(true);
                }}
              >
                Confirm & Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Prompt & Recalculate Modal */}
      {showEditModal && (
        <CreateWorkflowModal
          initialText={rawText || `${proposal?.name}: ${proposal?.description}`}
          onClose={() => setShowEditModal(false)}
          onResult={(res) => {
            setShowEditModal(false);
            onRecalculate?.(res);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}
    </div>
  );
}
