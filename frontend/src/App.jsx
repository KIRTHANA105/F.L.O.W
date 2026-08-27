import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Dashboard from "./components/Dashboard";
import CreateWorkflow from "./components/CreateWorkflow";
import Conflicts from "./components/Conflicts";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "create", label: "Create Workflow" },
  { id: "conflicts", label: "Conflicts" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [workflows, setWorkflows] = useState([]);
  const [stats, setStats] = useState(null);
  const [justDeployed, setJustDeployed] = useState("");
  const [conflictResult, setConflictResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [conflictError, setConflictError] = useState("");
  const [bootError, setBootError] = useState("");
  const [aiActive, setAiActive] = useState(false);
  const glowTimer = useRef(null);

  const triggerAiGlow = useCallback((durationMs = 3000) => {
    setAiActive(true);
    clearTimeout(glowTimer.current);
    glowTimer.current = setTimeout(() => setAiActive(false), durationMs);
  }, []);

  useEffect(() => {
    triggerAiGlow(7000);
    return () => clearTimeout(glowTimer.current);
  }, [triggerAiGlow]);

  const refresh = useCallback(async () => {
    try {
      const [wf, st] = await Promise.all([api.listWorkflows(), api.stats()]);
      setWorkflows(wf.workflows);
      setStats(st);
      setBootError("");
    } catch (e) {
      setBootError(`${e.message} — is the backend running on port 8000?`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDeployed = async (wf) => {
    await refresh();
    setJustDeployed(wf.name);
    setConflictResult(null); // stale once the rule set changes
    setTimeout(() => setJustDeployed(""), 8000);
  };

  const handleDelete = async (id) => {
    await api.deleteWorkflow(id);
    setConflictResult(null);
    refresh();
  };

  const handleScan = async () => {
    triggerAiGlow();
    setScanning(true);
    setConflictError("");
    try {
      setConflictResult(await api.scanConflicts());
      refresh();
    } catch (e) {
      setConflictError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const conflictCount = conflictResult?.conflicts_found || 0;

  return (
    <div className={aiActive ? "ai-glow-active app" : "app"}>
      <div className="topbar ai-header-pulse">
        <div className="brand">
          <div className="logo">F</div>
          <div>
            <h1>FLOW</h1>
            <p>Rule Intelligence · Copilot</p>
          </div>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "conflicts" && conflictCount > 0 && (
                <span className="badge-count">{conflictCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {bootError && <div className="error">⚠ {bootError}</div>}

      {tab === "dashboard" && (
        <Dashboard
          workflows={workflows}
          stats={stats}
          onRefresh={refresh}
          onDelete={handleDelete}
          justDeployed={justDeployed}
        />
      )}

      {tab === "create" && (
        <CreateWorkflow
          onDeployed={handleDeployed}
          onNavigate={setTab}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "conflicts" && (
        <Conflicts
          result={conflictResult}
          onScan={handleScan}
          scanning={scanning}
          error={conflictError}
          triggerAiGlow={triggerAiGlow}
        />
      )}
    </div>
  );
}
