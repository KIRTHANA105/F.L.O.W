/**
 * Beat 2 - the differentiator.
 *
 * Every competitor generates the workflow. Only FLOW says "you already built
 * 2 of these in January." This card is where that lands, so it leads with the
 * reuse count and names the workflow + department each capability comes from.
 */
export default function MemoryMatch({ match }) {
  if (!match) return null;

  const { reused = [], new: fresh = [], reuse_count, new_count, reuse_pct } = match;

  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Memory Match</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Checked against everything this company has already automated.
          </p>
        </div>
        <span className="pill-zero">
          Pure Python · <b>0</b> LLM calls
        </span>
      </div>

      <div className="memory-headline">
        <div className="memory-figure">
          <span className="reuse">{reuse_count}</span>
          <span className="slash">/</span>
          <span className="total">{reused.length + fresh.length}</span>
        </div>
        <div>
          <div className="memory-summary">{match.summary}</div>
          <div className="memory-note">
            {reuse_pct}% of this request is already covered by existing workflows.
          </div>
        </div>
      </div>

      <div className="memory-list">
        {reused.map((item) => (
          <div className="memory-row reuse" key={item.capability}>
            <span className="memory-tag reuse">REUSE</span>
            <div className="memory-body">
              <div className="memory-cap">{item.description || item.capability}</div>
              <div className="memory-src">
                already provided by{" "}
                {item.providers.map((p, i) => (
                  <span key={p.workflow_id}>
                    {i > 0 && ", "}
                    <b>{p.name}</b>{" "}
                    <span className="memory-dept">{p.department}</span>
                  </span>
                ))}
              </div>
            </div>
            <code className="memory-key">{item.capability}</code>
          </div>
        ))}

        {fresh.map((item) => (
          <div className="memory-row build" key={item.capability}>
            <span className="memory-tag build">BUILD</span>
            <div className="memory-body">
              <div className="memory-cap">{item.description || item.capability}</div>
              <div className="memory-src">not found in memory — this is the new work</div>
            </div>
            <code className="memory-key">{item.capability}</code>
          </div>
        ))}
      </div>

      {reused.length > 0 && (
        <div className="memory-footer">
          Without this check, {reuse_count} duplicate workflow
          {reuse_count === 1 ? "" : "s"} would have been created.
        </div>
      )}
    </div>
  );
}
