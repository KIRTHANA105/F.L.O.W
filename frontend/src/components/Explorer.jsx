import { useEffect, useState } from "react";
import { api } from "../api";
import { SourceBadge, Spinner, ErrorNote } from "./Shared";

/**
 * BPM Explorer - the Business Process Memory made visible.
 *
 * Department-grouped tree (spec 4.5): expand a department to see its workflows,
 * expand a workflow to see the capabilities it provides and the policies that
 * govern it. Capabilities used by more than one department are marked SHARED,
 * because that cross-department reuse is the thing a tree normally hides.
 */
export default function Explorer() {
  const [memory, setMemory] = useState(null);
  const [error, setError] = useState("");
  const [openDepts, setOpenDepts] = useState({});
  const [openFlows, setOpenFlows] = useState({});
  const [view, setView] = useState("tree");

  const load = async () => {
    try {
      const data = await api.memory();
      setMemory(data);
      // Open every department by default: an empty-looking tree reads as "no memory".
      setOpenDepts(
        Object.fromEntries(data.tree.map((t) => [t.department, true])),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!memory) {
    return (
      <div className="card">
        <Spinner />
        Loading process memory…
      </div>
    );
  }

  const toggleDept = (d) =>
    setOpenDepts((s) => ({ ...s, [d]: !s[d] }));
  const toggleFlow = (id) =>
    setOpenFlows((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div>
      <div className="stats-bar">
        <div className="stat">
          <div className="n">{memory.workflow_count}</div>
          <div className="l">Workflows in memory</div>
        </div>
        <div className="stat llm">
          <div className="n">{memory.capability_count}</div>
          <div className="l">Capabilities indexed</div>
        </div>
        <div className="stat">
          <div className="n">{memory.policy_count}</div>
          <div className="l">Active policies</div>
        </div>
        <div className="stat free">
          <div className="n">{memory.shared_count}</div>
          <div className="l">Shared across depts</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <div>
            <h2>Business Process Memory</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Everything this company has automated, grouped by the team that owns it.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="tabs" style={{ padding: 4 }}>
              <button
                className={`tab ${view === "tree" ? "active" : ""}`}
                onClick={() => setView("tree")}
              >
                Tree
              </button>
              <button
                className={`tab ${view === "caps" ? "active" : ""}`}
                onClick={() => setView("caps")}
              >
                Capabilities
              </button>
            </div>
            <button className="btn ghost" onClick={load}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {view === "tree" ? (
          <div className="tree">
            {memory.tree.map((dept) => (
              <div className="tree-dept" key={dept.department}>
                <button
                  className="tree-row dept"
                  onClick={() => toggleDept(dept.department)}
                >
                  <span className="caret">
                    {openDepts[dept.department] ? "▾" : "▸"}
                  </span>
                  <span className="tree-name">{dept.department}</span>
                  <span className="tree-meta">
                    {dept.workflow_count} workflow
                    {dept.workflow_count === 1 ? "" : "s"} ·{" "}
                    {dept.capability_count} capabilit
                    {dept.capability_count === 1 ? "y" : "ies"}
                  </span>
                </button>

                {openDepts[dept.department] &&
                  dept.workflows.map((wf) => (
                    <div key={wf.id}>
                      <button
                        className="tree-row flow"
                        onClick={() => toggleFlow(wf.id)}
                      >
                        <span className="caret">
                          {openFlows[wf.id] ? "▾" : "▸"}
                        </span>
                        <SourceBadge system={wf.source_system} />
                        <span className="tree-name">{wf.name}</span>
                        <span className="tree-meta">{wf.trigger}</span>
                      </button>

                      {openFlows[wf.id] && (
                        <div className="tree-detail">
                          <div className="tree-detail-label">Provides</div>
                          {wf.capabilities.length === 0 ? (
                            <div className="tree-empty">
                              No capabilities registered
                            </div>
                          ) : (
                            wf.capabilities.map((c) => (
                              <div className="tree-cap" key={c.key}>
                                <span className="tree-cap-desc">
                                  {c.description}
                                </span>
                                <code className="memory-key">{c.key}</code>
                                {c.shared && (
                                  <span className="shared-tag">SHARED</span>
                                )}
                              </div>
                            ))
                          )}

                          {wf.governed_by.length > 0 && (
                            <>
                              <div className="tree-detail-label">
                                Governed by
                              </div>
                              {wf.governed_by.map((p) => (
                                <div className="tree-policy" key={p.id}>
                                  § {p.text}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="memory-list">
            {memory.capabilities.map((c) => (
              <div
                className={`memory-row ${c.shared ? "build" : "reuse"}`}
                key={c.key}
              >
                <span className={`memory-tag ${c.shared ? "build" : "reuse"}`}>
                  {c.shared ? "SHARED" : "OWNED"}
                </span>
                <div className="memory-body">
                  <div className="memory-cap">{c.description}</div>
                  <div className="memory-src">
                    used by{" "}
                    {c.providers.map((p, i) => (
                      <span key={p.workflow_id}>
                        {i > 0 && ", "}
                        <b>{p.name}</b>{" "}
                        <span className="memory-dept">{p.department}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <code className="memory-key">{c.key}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
