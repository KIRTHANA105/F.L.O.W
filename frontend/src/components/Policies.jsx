import { useEffect, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote } from "./Shared";

/**
 * Policies (spec 4.2) - business rules in plain English, compiled once by the
 * LLM into a structure that pure Python can check every workflow against.
 * The user writes and reads sentences; the JSON stays behind the scenes.
 */
function describeRule(compiled) {
  if (!compiled) return "";
  if (compiled.type === "forbid") {
    const what = compiled.forbid_capability || "this action";
    return compiled.when_capability
      ? `Blocks ${what} whenever ${compiled.when_capability} also applies`
      : `Blocks ${what}`;
  }
  if (compiled.type === "require_approval_above") {
    const t = Number(compiled.threshold || 0).toLocaleString("en-IN");
    return `Requires ${compiled.approver || "approver"} sign-off above ${t}`;
  }
  return compiled.type || "";
}

export default function Policies({ triggerAiGlow }) {
  const [policies, setPolicies] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const data = await api.policies();
      setPolicies(data.policies);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!text.trim()) return;
    triggerAiGlow?.();
    setBusy(true);
    setError("");
    try {
      await api.createPolicy(text.trim());
      setText("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p) => {
    try {
      await api.togglePolicy(p.id, !p.active);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (p) => {
    try {
      await api.deletePolicy(p.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>Add a policy</h2>
        <p className="sub">
          Write the rule the way you'd say it. FLOW compiles it once, then checks
          every new workflow against it automatically.
        </p>

        <ErrorNote message={error} />

        <label className="field" htmlFor="policy-text">
          Policy
        </label>
        <textarea
          id="policy-text"
          rows={2}
          value={text}
          placeholder="e.g. Purchases over 80,000 need CFO approval."
          onChange={(e) => setText(e.target.value)}
        />
        <div className="form-row">
          <button className="btn" onClick={add} disabled={busy || !text.trim()}>
            {busy ? (
              <>
                <Spinner />
                Compiling…
              </>
            ) : (
              "Compile policy →"
            )}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <div>
            <h2>Active policies</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Checked against every workflow before it deploys — pure Python, 0 LLM calls.
            </p>
          </div>
          <button className="btn ghost" onClick={load}>
            ↻ Refresh
          </button>
        </div>

        {!loaded ? (
          <div className="empty">
            <Spinner />
            Loading…
          </div>
        ) : policies.length === 0 ? (
          <div className="empty">
            <div className="icon">§</div>
            No policies yet — add one above.
          </div>
        ) : (
          <div className="policy-list">
            {policies.map((p) => (
              <div
                className={`policy-row ${p.active ? "" : "inactive"}`}
                key={p.id}
              >
                <span className="policy-mark">§</span>
                <div className="policy-body">
                  <div className="policy-text">{p.text}</div>
                  <div className="policy-meta">
                    <span className="memory-dept">{p.department}</span>
                    {describeRule(p.compiled)}
                  </div>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => toggle(p)}
                  title={p.active ? "Deactivate" : "Reactivate"}
                >
                  {p.active ? "● Active" : "○ Paused"}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => remove(p)}
                  title="Delete policy"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
