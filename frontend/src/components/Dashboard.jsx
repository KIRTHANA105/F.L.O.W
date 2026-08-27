import { SourceBadge, PriorityBadge, summarize } from "./Shared";

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <div className="stat llm">
        <div className="n">{stats.llm_calls}</div>
        <div className="l">LLM calls this session</div>
      </div>
      <div className="stat free">
        <div className="n">{stats.rules_evaluated}</div>
        <div className="l">Rules evaluated · 0 LLM</div>
      </div>
      <div className="stat free">
        <div className="n">{stats.pairs_compared}</div>
        <div className="l">Conflict pairs · 0 LLM</div>
      </div>
      <div className="stat">
        <div className="n">{stats.conflict_llm_calls}</div>
        <div className="l">Explanations generated</div>
      </div>
    </div>
  );
}

export default function Dashboard({ workflows, stats, onRefresh, onDelete, justDeployed }) {
  return (
    <div>
      <StatsBar stats={stats} />

      <div className="card">
        <div className="section-title">
          <div>
            <h2>Active workflows</h2>
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
                      <span className="badge status-active">● ACTIVE</span>
                    </td>
                    <td>
                      <button
                        className="btn ghost"
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
