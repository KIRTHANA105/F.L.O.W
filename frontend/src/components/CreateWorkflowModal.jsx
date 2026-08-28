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

  // Inline automation suggestions
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestTimer = useRef(null);

  const backdropRef = useRef(null);

  const handleBackdrop = (e) => {
    if (e.target === backdropRef.current) onClose();
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Debounced suggestion fetch — fires 800ms after user stops typing.
  // Uses AbortController so every new keystroke cancels the prior in-flight request.
  useEffect(() => {
    if (step !== "idle") return;
    clearTimeout(suggestTimer.current);
    setSuggestLoading(false);

    if (!text || text.length < 15) {
      setSuggestions([]);
      return;
    }

    // Create a controller for this request cycle
    const controller = new AbortController();

    suggestTimer.current = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch("http://127.0.0.1:8010/api/suggest-automation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("suggest failed");
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch (e) {
        if (e.name !== "AbortError") setSuggestions([]);
      } finally {
        // Only clear loading state if this controller wasn't aborted
        if (!controller.signal.aborted) setSuggestLoading(false);
      }
    }, 800);

    // Cleanup: clear timer AND abort any in-flight fetch
    return () => {
      clearTimeout(suggestTimer.current);
      controller.abort();
    };
  }, [text, step]);

  const handleTextChange = (e) => {
    setText(e.target.value);
    setSuggestions([]);
  };

  const handleSuggestionClick = (s) => {
    // Extract the plain-English description from the suggestion chip
    // Chips are like "Trigger: X → Action: Y". We expand them into a full sentence.
    setText(s);
    setSuggestions([]);
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    triggerAiGlow?.();
    setError("");
    setSuggestions([]);
    setStep("analyzing");
    try {
      const analyzeResult = await api.analyze(text.trim());
      const proposal = analyzeResult.proposal;

      setStep("evaluating");
      const evalResult = await api.evaluate(proposal.id);

      // Pass everything to parent → stay on Dashboard, show new "created" card
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

          <div style={{ position: "relative" }}>
            <textarea
              id="workflow-description"
              className="workflow-textarea"
              rows={5}
              value={text}
              disabled={step !== "idle"}
              placeholder="e.g. When a form is submitted, lookup the contact in HubSpot and update the lifecycle stage…"
              onChange={handleTextChange}
              autoFocus
            />
            {/* AI thinking indicator */}
            {suggestLoading && step === "idle" && (
              <div style={{
                position: "absolute", bottom: 10, right: 12,
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, color: "#6366f1", fontWeight: 600,
              }}>
                <Spinner /> ✦ AI is thinking…
              </div>
            )}
          </div>

          {/* Inline Automation Suggestion Chips */}
          {suggestions.length > 0 && step === "idle" && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#6366f1",
                textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <span>✦</span> Automation Suggestions — click to populate
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSuggestionClick(s)}
                    style={{
                      background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02))",
                      border: "1px solid rgba(99,102,241,0.25)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: "#1e293b",
                      fontWeight: 500,
                      lineHeight: 1.4,
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))";
                      e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02))";
                      e.currentTarget.style.borderColor = "rgba(99,102,241,0.25)";
                    }}
                  >
                    <span style={{ color: "#6366f1", marginRight: 6 }}>✦</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

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
