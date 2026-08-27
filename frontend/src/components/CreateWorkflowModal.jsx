import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote } from "./Shared";

const CONFLICT_EXAMPLE =
  "When an enterprise deal is closed, automatically start customer onboarding immediately and schedule the implementation kickoff.";

const COMPATIBLE_EXAMPLE =
  "After Finance Verification is completed for an enterprise customer, automatically notify Customer Success and create the onboarding workspace.";

const EXAMPLES = [
  { label: "Demo: conflict scenario", text: CONFLICT_EXAMPLE },
  { label: "Demo: compatible scenario", text: COMPATIBLE_EXAMPLE },
];

/**
 * Modal for creating a new workflow from natural language.
 * Calls /api/analyze then /api/evaluate and navigates to the Conflicts page.
 */
export default function CreateWorkflowModal({ onClose, onResult, triggerAiGlow }) {
  const [text, setText] = useState("");
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

      // Pass everything to parent → navigate to Conflicts
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
              Write it the way you'd say it. The system will evaluate it
              against Nexora's existing process architecture and policies.
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
            placeholder="e.g. When an enterprise deal is closed, automatically start customer onboarding and schedule the implementation kickoff…"
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />

          <div className="examples" style={{ marginTop: 12 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                className="chip"
                disabled={step !== "idle"}
                onClick={() => setText(ex.text)}
              >
                {ex.label}
              </button>
            ))}
          </div>

          {step !== "idle" && (
            <div className="analyze-progress">
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
