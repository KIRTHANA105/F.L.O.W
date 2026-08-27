import { useEffect, useState } from "react";
import { api } from "../api";
import { SourceBadge, PriorityBadge, Spinner, ErrorNote } from "./Shared";

const DEMO_RULE =
  "If order stays in packed status for more than 48 hours, alert warehouse and flag on dashboard";

const EXAMPLES = [
  {
    label: "Demo rule — stale packed orders",
    text: DEMO_RULE,
    source: "ERPNext",
  },
  {
    label: "Conflict rule — flag big invoices",
    text: "When an invoice is submitted for more than 30000, flag it for manual review by finance",
    source: "Zoho",
  },
];

function ParsedRule({ workflow }) {
  return (
    <div>
      <div className="meta-line">
        <SourceBadge system={workflow.source_system} />
        <PriorityBadge priority={workflow.priority} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>{workflow.name}</span>
      </div>

      <div className="parsed-grid">
        <div className="parsed-card trigger">
          <div className="kicker">Trigger</div>
          <div className="value">{workflow.trigger}</div>
        </div>

        <div className="parsed-card condition">
          <div className="kicker">
            Condition
            {workflow.conditions.length === 1
              ? ""
              : `s (${workflow.conditions.length})`}
          </div>
          <ul>
            {workflow.conditions.map((c, i) => (
              <li key={i}>{c.display}</li>
            ))}
          </ul>
        </div>

        <div className="parsed-card action">
          <div className="kicker">
            Action
            {workflow.actions.length === 1
              ? ""
              : `s (${workflow.actions.length})`}
          </div>
          <ul>
            {workflow.actions.map((a, i) => (
              <li key={i}>{a.display}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SimulationResults({ sim }) {
  return (
    <div className="card">
      <div className="sim-summary">
        <div className="big">
          {sim.matched}/{sim.total}
        </div>
        <div>
          <div className="txt">{sim.summary}</div>
          <div className="note">
            {sim.evaluations} condition checks across {sim.total} historical
            records
          </div>
        </div>
        <div className="pill-zero">
          LLM calls used: <b>0</b> — pure Python
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{sim.id_label}</th>
              <th>Status</th>
              <th>Hours since update</th>
              <th>Amount</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sim.results.map((r) => (
              <tr key={r.record_id} className={r.matched ? "matched" : ""}>
                <td className="mono">{r.record_id}</td>
                <td>{r.status}</td>
                <td className="mono">
                  {r.hours_since_update == null
                    ? "—"
                    : `${r.hours_since_update}h`}
                </td>
                <td className="mono">
                  {r.amount == null
                    ? "—"
                    : `₹${r.amount.toLocaleString("en-IN")}`}
                </td>
                <td className={r.matched ? "match-yes" : "match-no"}>
                  {r.matched ? "✓ MATCHED" : "— not matched"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CreateWorkflow({ onDeployed, onNavigate }) {
  const [text, setText] = useState(DEMO_RULE);
  const [source, setSource] = useState("ERPNext");
  const [parsed, setParsed] = useState(null);
  const [sim, setSim] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [deployment, setDeployment] = useState(null);

  useEffect(() => {
    if (!deployment) return undefined;
    const timer = setTimeout(() => setDeployment(null), 6000);
    return () => clearTimeout(timer);
  }, [deployment]);

  const reset = () => {
    setParsed(null);
    setSim(null);
    setError("");
  };

  const handleParse = async () => {
    setBusy("parse");
    setError("");
    setSim(null);
    try {
      const data = await api.parse(text, source);
      setParsed(data.workflow);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const handleSimulate = async () => {
    setBusy("simulate");
    setError("");
    try {
      setSim(await api.simulate(parsed));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const handleDeploy = async () => {
    setBusy("deploy");
    setError("");
    try {
      const data = await api.createWorkflow(parsed);
      setDeployment(data);
      reset();
      setText("");
      onDeployed(data.workflow);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      {deployment && (
        <div
          className={`deployment-banner ${deployment.conflicts_detected > 0 ? "warning" : "success"}`}
        >
          <span>
            {deployment.conflicts_detected > 0
              ? `⚠ ${deployment.conflicts_detected} conflict(s) detected with existing rules. View in Conflicts tab.`
              : "✓ Rule deployed. No conflicts found."}
          </span>
          {deployment.conflicts_detected > 0 && (
            <button
              className="banner-link"
              onClick={() => onNavigate("conflicts")}
            >
              View Conflicts
            </button>
          )}
        </div>
      )}
      <div className="card">
        <h2>Describe a rule in plain English</h2>
        <p className="sub">
          Write it the way you would say it to a colleague. FLOW turns it into a
          structured, executable workflow.
        </p>

        <ErrorNote message={error} />

        <label className="field" htmlFor="rule-text">
          Rule description
        </label>
        <textarea
          id="rule-text"
          rows={3}
          value={text}
          placeholder="e.g. If an order stays in packed status for more than 48 hours, alert the warehouse…"
          onChange={(e) => {
            setText(e.target.value);
            if (parsed) reset();
          }}
        />

        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              className="chip"
              onClick={() => {
                setText(ex.text);
                setSource(ex.source);
                reset();
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="form-row">
          <div className="grow">
            <label className="field" htmlFor="source-system">
              Source system
            </label>
            <select
              id="source-system"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option>ERPNext</option>
              <option>Zoho</option>
              <option>Internal</option>
            </select>
          </div>
          <button
            className="btn"
            onClick={handleParse}
            disabled={busy !== "" || !text.trim()}
          >
            {busy === "parse" ? (
              <>
                <Spinner />
                Parsing…
              </>
            ) : (
              "Parse →"
            )}
          </button>
        </div>
      </div>

      {parsed && (
        <div className="card">
          <div className="section-title">
            <div>
              <h2>Structured workflow</h2>
              <p className="sub" style={{ marginBottom: 0 }}>
                Extracted by Claude from your sentence.
              </p>
            </div>
            <span className="step-hint">
              Next: <b>simulate it against real history</b>
            </span>
          </div>

          <ParsedRule workflow={parsed} />

          <div className="form-row">
            <button
              className="btn secondary"
              onClick={handleSimulate}
              disabled={busy !== ""}
            >
              {busy === "simulate" ? (
                <>
                  <Spinner />
                  Running…
                </>
              ) : (
                "▶ Simulate"
              )}
            </button>
            <button
              className="btn success"
              onClick={handleDeploy}
              disabled={busy !== ""}
            >
              {busy === "deploy" ? (
                <>
                  <Spinner />
                  Deploying…
                </>
              ) : (
                "✓ Confirm & Deploy"
              )}
            </button>
          </div>
        </div>
      )}

      {sim && <SimulationResults sim={sim} />}
    </div>
  );
}
