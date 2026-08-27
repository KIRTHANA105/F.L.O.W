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

          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Quick Demo Templates
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
                style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: "12px" }}
              >
                ⛔ Demo: Conflicting Workflow (HubSpot Loop)
              </button>
              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "Every morning on a schedule, read customer rows from Google Sheets for daily status review."
                  )
                }
                style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", fontSize: "12px" }}
              >
                ✓ Demo: Compatible Direct Workflow (Read-Only)
              </button>
              <button
                type="button"
                className="chip"
                disabled={step !== "idle"}
                onClick={() =>
                  setText(
                    "When a user submits a lead form, append the row into Google Sheets."
                  )
                }
                style={{ background: "#f8fafc", color: "#334155", border: "1px solid #e2e8f0", fontSize: "12px" }}
              >
                ⚙ Demo: Standard Workflow (Google Sheets)
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
