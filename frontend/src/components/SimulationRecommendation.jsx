import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote } from "./Shared";

/**
 * Post-Creation Simulation Recommendation (SVS Engine)
 * Sits inline in the review/conflicts screen before activation.
 */
export default function SimulationRecommendation({
  workflowId,
  onSimulate,
  onAdopt,
  disabled = false,
}) {
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  const fetchRecommendation = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const data = await api.getRecommendation(workflowId);
      setRec(data);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to compute simulation recommendation");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchRecommendation();
  }, [fetchRecommendation]);

  if (loading) {
    return (
      <div className="rec-card rec-loading-skeleton">
        <div className="rec-skeleton-header">
          <Spinner /> <span>Computing SVS risk score & recommendation…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorNote message={error} />;
  }

  if (!rec) return null;

  const isDirect = rec.decision === "DIRECT";
  const isDeep = rec.tier === "DEEP";
  const isStandard = rec.tier === "STANDARD";

  const cardBorderClass = isDirect
    ? "rec-direct-border"
    : isDeep
    ? "rec-deep-border"
    : "rec-standard-border";

  const bannerTitle = isDirect
    ? "RECOMMENDED: DIRECT ACTIVATION"
    : isDeep
    ? "RECOMMENDED: FULL SIMULATION"
    : isStandard
    ? "RECOMMENDED: STANDARD SIMULATION"
    : "RECOMMENDED: SHALLOW SIMULATION";

  const topFactor = (rec.factors || [])[0] || { label: "Risk factor", value: "State modifications" };

  return (
    <>
      <div className={`rec-card ${cardBorderClass}`}>
        <div className="rec-card-header">
          <div className="rec-title-group">
            <span className={`rec-badge-icon ${isDirect ? "icon-direct" : "icon-simulate"}`}>
              {isDirect ? "✓" : "⚠"}
            </span>
            <span className="rec-badge-title">{bannerTitle}</span>
          </div>

          {!isDirect && rec.tier && (
            <span className={`rec-tier-pill tier-${rec.tier.toLowerCase()}`}>
              SVS Tier: {rec.tier}
            </span>
          )}
        </div>

        <div className="rec-headline">{rec.headline}</div>

        {/* 4-Factor Risk Breakdown */}
        <div className="rec-factors-table">
          {(rec.factors || []).map((f, i) => (
            <div key={i} className="rec-factor-row">
              <span className="rec-factor-lbl">{f.label}</span>
              <div className="rec-factor-right">
                <span className="rec-factor-val">{f.value}</span>
                <span
                  className={`rec-level-dot dot-${f.level}`}
                  title={`Risk level: ${f.level}`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Scenario & Estimate Footer */}
        {!isDirect && rec.scenario_count > 0 && (
          <div className="rec-scenario-meta">
            ⚡ <strong>{rec.scenario_count} test scenarios</strong> · about {rec.estimated_seconds} second{rec.estimated_seconds !== 1 ? "s" : ""}
          </div>
        )}

        {/* Actions */}
        <div className="rec-actions-row">
          {isDirect ? (
            <>
              <button
                className="btn success btn-sm rec-btn-primary"
                onClick={onAdopt}
                disabled={disabled}
              >
                ✓ Activate Workflow
              </button>
              <button
                className="btn ghost btn-sm"
                onClick={() => onSimulate?.(workflowId)}
                disabled={disabled}
              >
                ⚡ Simulate anyway
              </button>
            </>
          ) : (
            <>
              <button
                className="btn primary btn-sm rec-btn-primary"
                onClick={() => onSimulate?.(workflowId)}
                disabled={disabled}
              >
                ⚡ Run Simulation
              </button>
              <button
                className="btn-text-subtle"
                onClick={() => setShowOverrideModal(true)}
                disabled={disabled}
              >
                Activate anyway
              </button>
            </>
          )}
        </div>
      </div>

      {/* Override Confirm Dialog */}
      {showOverrideModal && (
        <div className="modal-backdrop" onClick={() => setShowOverrideModal(false)}>
          <div className="modal-panel rec-override-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="override-dialog-header">
              <span className="override-warn-icon">⚠</span>
              <h3>Skip Recommended Simulation?</h3>
            </div>

            <div className="override-dialog-body">
              <p>
                FLOW recommends running a <strong>{rec.tier || "Standard"}</strong> simulation before activating this workflow due to:
              </p>
              <div className="override-risk-box">
                <strong>{topFactor.label}:</strong> {topFactor.value}
              </div>
              <p className="override-note">
                Activating unverified workflows may cause unintended side effects in production.
              </p>
            </div>

            <div className="override-dialog-footer">
              <button
                className="btn ghost btn-sm"
                onClick={() => setShowOverrideModal(false)}
              >
                Cancel & Review
              </button>
              <button
                className="btn danger btn-sm"
                onClick={() => {
                  setShowOverrideModal(false);
                  onAdopt();
                }}
              >
                Confirm & Activate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
