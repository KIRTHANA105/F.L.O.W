import { useState } from "react";
import { api } from "../api";
import { SourceBadge, Spinner, ErrorNote, summarize } from "./Shared";

function RuleSide({ rule, stance }) {
  return (
    <div className="rule-side">
      <SourceBadge system={rule.source_system} />
      <h4>{rule.name}</h4>
      <div className="row">
        <span className="k">Trigger</span>
        <span>{rule.trigger}</span>
      </div>
      <div className="row">
        <span className="k">Conditions</span>
        <span>{summarize(rule.conditions)}</span>
      </div>
      <div className="row">
        <span className="k">Actions</span>
        <span>{summarize(rule.actions)}</span>
      </div>
      <span className={`stance ${stance}`}>
        {stance === "permissive" ? "✓ LETS IT THROUGH" : "⛔ STOPS IT"}
      </span>
    </div>
  );
}

function ConflictCard({ conflict }) {
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const explain = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api.explainConflict(conflict);
      setExplanation(data.explanation);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const affected = conflict.affected || {};

  return (
    <div className="conflict-card">
      <div className="conflict-banner">
        <span className="pulse-dot" />
        <span className="title">CONFLICT DETECTED</span>
        <span className="where">
          Both rules fire on “{conflict.trigger}” — and they disagree.
        </span>
      </div>

      <div className="conflict-body">
        <RuleSide rule={conflict.rule_a} stance={conflict.stance_a} />
        <div className="vs">VS</div>
        <RuleSide rule={conflict.rule_b} stance={conflict.stance_b} />
      </div>

      <div className="overlap-strip">
        <span className="tag">OVERLAP</span>
        <span>
          <b>{conflict.overlap_label}</b> — records in this band match both rules at once.
        </span>
        {affected.count > 0 && (
          <span style={{ color: "var(--muted)" }}>
            {affected.count} live record{affected.count === 1 ? "" : "s"} affected right now:{" "}
            <span className="mono">{affected.ids.join(", ")}</span>
          </span>
        )}
      </div>

      <div className="conflict-actions">
        <button className="btn danger" onClick={explain} disabled={busy}>
          {busy ? (
            <>
              <Spinner />
              Asking Claude…
            </>
          ) : (
            "✦ Explain this conflict"
          )}
        </button>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Detection was pure Python — this button is the only LLM call.
        </span>
      </div>

      {error && (
        <div style={{ padding: "0 20px 18px" }}>
          <ErrorNote message={error} />
        </div>
      )}

      {explanation && (
        <div className="explanation">
          <div className="who">✦ Claude's analysis</div>
          {explanation.split(/\n\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Conflicts({ result, onScan, scanning, error }) {
  return (
    <div>
      <div className="card">
        <div className="section-title">
          <div>
            <h2>Conflict scanner</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Compares every active rule pair for overlapping conditions with contradictory
              outcomes.
            </p>
          </div>
          <button className="btn danger" onClick={onScan} disabled={scanning}>
            {scanning ? (
              <>
                <Spinner />
                Scanning…
              </>
            ) : (
              "⟳ Scan for Conflicts"
            )}
          </button>
        </div>

        <ErrorNote message={error} />

        {result && (
          <div
            className={result.conflicts_found > 0 ? "overlap-strip" : "ok-banner"}
            style={{ borderRadius: 12 }}
          >
            {result.conflicts_found > 0 ? (
              <>
                <span className="tag">{result.conflicts_found} FOUND</span>
                <span>{result.summary}</span>
                <span style={{ color: "var(--muted)", marginLeft: "auto" }}>
                  0 LLM calls used to detect
                </span>
              </>
            ) : (
              <>✓ {result.summary} — all active rules are consistent.</>
            )}
          </div>
        )}

        {!result && !scanning && (
          <div className="empty">
            <div className="icon">⚡</div>
            Click <b>Scan for Conflicts</b> to check every active rule pair.
          </div>
        )}
      </div>

      {result?.conflicts.map((c) => (
        <ConflictCard key={c.id} conflict={c} />
      ))}
    </div>
  );
}
