import { useEffect, useState } from "react";
import { api } from "../api";
import { DepartmentBadge, Spinner, ErrorNote } from "./Shared";

/**
 * Process Memory — the company's full operational architecture.
 *
 * Shows the process graph as a department-grouped layout with
 * workflow nodes and dependency edges visualized as SVG arrows.
 * Clicking a node shows detail on the right.
 */

const DEPT_COLORS = {
  Sales: "#6366f1",
  Finance: "#10b981",
  Legal: "#f59e0b",
  "Customer Success": "#3b82f6",
  Support: "#8b5cf6",
  Procurement: "#f97316",
  Operations: "#6b7280",
};

const REL_STYLE = {
  precedes: { stroke: "#6b7280", dash: "none", label: "precedes" },
  requires: { stroke: "#ef4444", dash: "6,3", label: "requires" },
  triggers: { stroke: "#3b82f6", dash: "4,2", label: "triggers" },
};

// ─── Node detail side panel ───────────────────────────────────────────────────
function NodeDetail({ workflow, allWorkflows, edges, onClose }) {
  if (!workflow) return null;
  const byId = Object.fromEntries(allWorkflows.map((w) => [w.id, w]));
  const outgoing = edges.filter((e) => e.from_workflow_id === workflow.id);
  const incoming = edges.filter((e) => e.to_workflow_id === workflow.id);

  return (
    <div className="memory-detail-panel">
      <div className="memory-detail-header">
        <div>
          <DepartmentBadge department={workflow.department} />
          <h3 className="memory-detail-name">{workflow.name}</h3>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <p className="memory-detail-desc">{workflow.description}</p>

      <div className="memory-detail-section">
        <div className="memory-detail-label">Steps</div>
        <div className="step-flow compact">
          {(workflow.steps || []).map((s, i) => (
            <div key={i} className="step-flow-item compact">
              <div className="step-node compact">
                <div className="step-num compact">{i + 1}</div>
                <div className="step-info">
                  <div className="step-name">{s.name}</div>
                  {s.description && (
                    <div className="step-desc">{s.description}</div>
                  )}
                </div>
              </div>
              {i < (workflow.steps || []).length - 1 && (
                <div className="step-connector compact" />
              )}
            </div>
          ))}
        </div>
      </div>

      {workflow.business_rules?.length > 0 && (
        <div className="memory-detail-section">
          <div className="memory-detail-label">Business Rules</div>
          {workflow.business_rules.map((r, i) => (
            <div key={i} className="business-rule-row compact">
              <div className="rule-condition">◆ {r.condition}</div>
              <div className="rule-path">→ {r.path}</div>
            </div>
          ))}
        </div>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="memory-detail-section">
          <div className="memory-detail-label">Process Connections</div>
          {incoming.map((e, i) => (
            <div key={`in-${i}`} className="connection-row in">
              <span className="conn-arrow">← </span>
              <span className="conn-name">
                {byId[e.from_workflow_id]?.name || "?"}
              </span>
              <span className="conn-rel">{e.relationship}</span>
            </div>
          ))}
          {outgoing.map((e, i) => (
            <div key={`out-${i}`} className="connection-row out">
              <span className="conn-arrow">→ </span>
              <span className="conn-name">
                {byId[e.to_workflow_id]?.name || "?"}
              </span>
              <span className="conn-rel">{e.relationship}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Department cluster ───────────────────────────────────────────────────────
function DeptCluster({ dept, workflows, selectedId, onSelect }) {
  const color = DEPT_COLORS[dept] || DEPT_COLORS.Operations;
  return (
    <div
      className="dept-cluster"
      style={{ "--dept-color": color }}
    >
      <div className="cluster-header">
        <span className="cluster-dot" style={{ background: color }} />
        <span className="cluster-name">{dept}</span>
        <span className="cluster-count">{workflows.length}</span>
      </div>
      <div className="cluster-nodes">
        {workflows.map((wf) => (
          <button
            key={wf.id}
            id={`wf-node-${wf.id}`}
            className={`memory-node${selectedId === wf.id ? " selected" : ""}`}
            onClick={() => onSelect(wf)}
            style={{ borderColor: color }}
          >
            <div className="node-name">{wf.name}</div>
            <div className="node-meta">{wf.step_count || wf.steps?.length || 0} steps</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Explorer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const d = await api.processMemory();
      setData(d);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <Spinner /> <span style={{ marginLeft: 10 }}>Loading process memory…</span>
      </div>
    );
  }

  const { departments, nodes, edges, workflow_count, policy_count } = data;

  const statsItems = [
    { n: workflow_count, l: "Workflows" },
    { n: edges.length, l: "Process connections" },
    { n: departments.length, l: "Departments" },
    { n: policy_count, l: "Active policies" },
  ];

  // Build a lookup of all workflows for the detail panel
  const allWorkflows = departments.flatMap((d) => d.workflows || []);

  return (
    <div className="memory-page">
      {/* Header */}
      <div className="memory-header">
        <div>
          <h2 className="section-heading">Process Memory</h2>
          <p className="section-sub">
            Nexora Technologies' complete operational architecture — workflows,
            dependencies, and the business rules that govern them.
          </p>
        </div>
        <button className="btn ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Stats */}
      <div className="memory-stats">
        {statsItems.map((s) => (
          <div key={s.l} className="memory-stat">
            <div className="memory-stat-n">{s.n}</div>
            <div className="memory-stat-l">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        {Object.entries(REL_STYLE).map(([rel, style]) => (
          <div key={rel} className="legend-item">
            <svg width="28" height="10">
              <line
                x1="0" y1="5" x2="28" y2="5"
                stroke={style.stroke}
                strokeWidth="2"
                strokeDasharray={style.dash === "none" ? undefined : style.dash}
              />
            </svg>
            <span>{rel}</span>
          </div>
        ))}
        <div className="legend-item">
          <div className="legend-node-sample" />
          <span>workflow node (click for details)</span>
        </div>
      </div>

      <div className={`memory-layout${selected ? " has-detail" : ""}`}>
        {/* Graph area */}
        <div className="memory-graph">
          <div className="dept-clusters">
            {departments.map((d) => (
              <DeptCluster
                key={d.department}
                dept={d.department}
                workflows={d.workflows || []}
                selectedId={selected?.id}
                onSelect={(wf) =>
                  setSelected((prev) => (prev?.id === wf.id ? null : wf))
                }
              />
            ))}
          </div>

          {/* Dependency edges as a simple visual list below clusters */}
          {edges.length > 0 && (
            <div className="edge-list">
              <div className="edge-list-label">Process Dependencies</div>
              {edges.map((e) => {
                const fromWf = allWorkflows.find((w) => w.id === e.from_workflow_id);
                const toWf = allWorkflows.find((w) => w.id === e.to_workflow_id);
                const style = REL_STYLE[e.relationship] || REL_STYLE.precedes;
                return (
                  <div key={e.id} className="edge-row">
                    <span className="edge-from">{fromWf?.name || "?"}</span>
                    <span
                      className="edge-rel-badge"
                      style={{ color: style.stroke, borderColor: style.stroke }}
                    >
                      {e.relationship}
                    </span>
                    <span className="edge-arrow-line" style={{ color: style.stroke }}>→</span>
                    <span className="edge-to">{toWf?.name || "?"}</span>
                    {e.label && <span className="edge-label-text">{e.label}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail side panel */}
        {selected && (
          <NodeDetail
            workflow={selected}
            allWorkflows={allWorkflows}
            edges={edges}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
