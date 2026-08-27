import { useEffect, useState } from "react";
import { api } from "../api";
import { SourceBadge, PriorityBadge, summarize } from "./Shared";

function HealthScore() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await api.healthScore();
        if (mounted) setHealth(result);
      } catch {
        // The dashboard remains usable if health scoring is temporarily unavailable.
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const score = health?.score ?? "—";
  const tone =
    typeof score !== "number"
      ? "neutral"
      : score >= 80
        ? "good"
        : score >= 50
          ? "warn"
          : "bad";
  return (
    <div className={`health-widget ${tone}`}>
      <div className="health-score">{score}</div>
      <div className="health-label">System Health</div>
    </div>
  );
}

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <HealthScore />
      <div className="stat llm">
        <div className="stat-number">
          <span className="stat-accent" />
          {stats.llm_calls}
        </div>
        <div className="l">LLM calls this session</div>
      </div>
      <div className="stat free">
        <div className="stat-number">
          <span className="stat-accent" />
          {stats.rules_evaluated}
        </div>
        <div className="l">Rules evaluated · 0 LLM</div>
      </div>
      <div className="stat free">
        <div className="stat-number">
          <span className="stat-accent" />
          {stats.pairs_compared}
        </div>
        <div className="l">Conflict pairs · 0 LLM</div>
      </div>
      <div className="stat">
        <div className="stat-number">
          <span className="stat-accent" />
          {stats.conflict_llm_calls}
        </div>
        <div className="l">Explanations generated</div>
      </div>
    </div>
  );
}

export default function Dashboard({
  workflows,
  stats,
  onRefresh,
  onDelete,
  justDeployed,
}) {
  return (
    <div>
      <StatsBar stats={stats} />

      <div className="card">
        <div className="section-title">
          <div>
            <h2>Active Rules</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Every rule currently live across your connected systems.
            </p>
          </div>
          <button className="btn ghost" onClick={onRefresh}>
            ↻ Refresh
          </button>
        </div>

        {justDeployed && (
          <div className="ok-banner" style={{ marginBottom: 18 }}>
            ✓ “{justDeployed}” is now live and monitoring incoming records.
          </div>
        )}

        {workflows.length === 0 ? (
          <div className="empty">
            <div className="icon">◇</div>
            No workflows yet — create one on the Create Workflow tab.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Rule</th>
                  <th>Trigger</th>
                  <th>Conditions</th>
                  <th>Actions</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <SourceBadge system={w.source_system} />
                    </td>
                    <td style={{ fontWeight: 600 }}>{w.name}</td>
                    <td>{w.trigger}</td>
                    <td className="cond-summary">{summarize(w.conditions)}</td>
                    <td className="cond-summary">{summarize(w.actions)}</td>
                    <td>
                      <PriorityBadge priority={w.priority} />
                    </td>
                    <td>
                      <span className="status-active">
                        <span className="status-dot" />
                        Active
                      </span>
                    </td>
                    <td>
                      <button
                        className="remove-button"
                        title="Remove workflow"
                        onClick={() => onDelete(w.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
