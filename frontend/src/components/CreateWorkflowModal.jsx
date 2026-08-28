import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote } from "./Shared";

export default function CreateWorkflowModal({
  onClose,
  onResult,
  triggerAiGlow,
  initialText = "",
}) {
  const [text, setText] = useState(initialText || "");
  const [step, setStep] = useState("idle"); // idle | analyzing | evaluating | done
  const [error, setError] = useState("");
  const backdropRef = useRef(null);

  const handleBackdrop = (e) => {
    if (e.target === backdropRef.current) onClose();
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    triggerAiGlow?.();
    setError("");
    setStep("analyzing");
    try {
      const analyzeResult = await api.analyze(text.trim());
      const proposal = analyzeResult.proposal;

      setStep("evaluating");
      const evalResult = await api.evaluate(proposal.id);

      // Pass everything to parent → navigate to Decision Gate
      onResult({
        proposal,
        evaluation: evalResult,
        rawText: text.trim(),
      });
    } catch (e) {
      setError(e.message);
      setStep("idle");
    }
  };

  const stepMessages = {
    analyzing: "Parsing workflow structure…",
    evaluating: "Evaluating against process memory…",
  };

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onClick={handleBackdrop}
    >
      <div className="modal-panel create-workflow-modal">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Describe a new workflow</h2>
            <p className="modal-desc">
              Write it in natural language. FLOW will compile it into structured steps,
              check for field collisions, and evaluate it against process memory.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <ErrorNote message={error} />

          <textarea
            id="workflow-description"
            className="workflow-textarea"
            rows={5}
            value={text}
            disabled={step !== "idle"}
            placeholder="e.g. When a form is submitted, lookup the contact in HubSpot and update the lifecycle stage…"
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />

          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Quick Demo Templates (Click to Populate)
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "When a contact is updated in HubSpot, automatically update the contact owner in HubSpot to re-assign regional territory."
                  )
                }
                style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "8px", cursor: "pointer" }}
                title="Triggers static conflict detection & infinite cycle loop warning"
              >
                ⛔ Demo: Cyclic Conflict (HubSpot Contact Loop)
              </button>

              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "When a new lead form is submitted, send a formatted notification message to the #sales-alerts Slack channel."
                  )
                }
                style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "8px", cursor: "pointer" }}
                title="Safe read/notify flow that passes straight to direct execution"
              >
                ✓ Demo: Direct Activation (Slack Lead Alert)
              </button>

              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "When a payment refund is initiated in Stripe, verify charge status, create a credit memo in QuickBooks, and send an email receipt to the customer."
                  )
                }
                style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "8px", cursor: "pointer" }}
                title="Multi-step financial automation requiring simulation verification"
              >
                ⚡ Demo: Financial Flow (Stripe Refund & Invoice)
              </button>

              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "When an employee requests AWS access in Jira Service Management, check manager approval, create Okta temporary assignment, and log audit event to Datadog."
                  )
                }
                style={{ background: "#faf5ff", color: "#6b21a8", border: "1px solid #e9d5ff", fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "8px", cursor: "pointer" }}
                title="Human-in-the-loop security access provisioning"
              >
                🛡 Demo: Enterprise Security (Jira Access Provisioning)
              </button>

              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "Every morning at 8:00 AM, extract active customer rows from Google Sheets, validate data schema, and sync records into the PostgreSQL analytics database."
                  )
                }
                style={{ background: "#f8fafc", color: "#334155", border: "1px solid #e2e8f0", fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "8px", cursor: "pointer" }}
                title="Scheduled batch ingestion pipeline"
              >
                ⏱ Demo: Daily Sync (Sheets to PostgreSQL)
              </button>
            </div>
          </div>

          {step !== "idle" && (
            <div className="analyze-progress" style={{ marginTop: 12 }}>
              <Spinner />
              <span>{stepMessages[step] || "Processing…"}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn ghost"
            onClick={onClose}
            disabled={step !== "idle"}
          >
            Cancel
          </button>
          <button
            id="analyze-workflow-btn"
            className="btn analyze-btn"
            onClick={handleAnalyze}
            disabled={step !== "idle" || !text.trim()}
          >
            {step === "idle" ? (
              <>
                Analyze Workflow{" "}
                <span className="btn-arrow">→</span>
              </>
            ) : (
              <>
                <Spinner />
                Analyzing…
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
