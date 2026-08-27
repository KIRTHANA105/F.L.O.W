import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Dashboard from "./components/Dashboard";
import Conflicts from "./components/Conflicts";
import Explorer from "./components/Explorer";
import Policies from "./components/Policies";
import Auth from "./pages/Auth";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "memory", label: "Process Memory" },
  { id: "conflicts", label: "Conflicts" },
  { id: "policies", label: "Policies" },
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [workflows, setWorkflows] = useState([]);
  const [bootError, setBootError] = useState("");
  const [aiActive, setAiActive] = useState(false);
  const [welcome, setWelcome] = useState("");
  const [justDeployed, setJustDeployed] = useState("");
  // pending = { proposal, evaluation, rawText } — created by CreateWorkflowModal
  const [pendingConflict, setPendingConflict] = useState(null);
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

  const handleAuthSuccess = (user, mode) => {
    setIsAuthenticated(true);
    setWelcome(
      mode === "signup"
        ? "Account created. Welcome to FLOW."
        : `Welcome back, ${user.name} 👋`,
    );
    setTimeout(() => setWelcome(""), 4000);
  };

  const refresh = useCallback(async () => {
    try {
      const wf = await api.listWorkflows();
      setWorkflows(wf.workflows);
      setBootError("");
    } catch (e) {
      setBootError(`${e.message} — is the backend running on port 8010?`);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  if (!isAuthenticated) {
    return <Auth onSuccess={handleAuthSuccess} triggerAiGlow={triggerAiGlow} />;
  }

  /**
   * Called by CreateWorkflowModal when analyze + evaluate is done.
   * Saves the result and navigates to Conflicts.
   */
  const handleWorkflowResult = (result) => {
    setPendingConflict(result);
    setTab("conflicts");
  };

  /**
   * Called when a proposed workflow is adopted on the Conflicts page.
   */
  const handleAdopt = async (adoptedWorkflow) => {
    await refresh();
    if (adoptedWorkflow?.name) {
      setJustDeployed(adoptedWorkflow.name);
      setTimeout(() => setJustDeployed(""), 8000);
    }
    setPendingConflict(null);
  };

  /**
   * Called when a proposed workflow is rejected.
   */
  const handleReject = () => {
    setPendingConflict(null);
  };

  const conflictPending = !!pendingConflict;

  return (
    <div className={aiActive ? "ai-glow-active app" : "app"}>
      {welcome && <div className="welcome-toast">{welcome}</div>}

      <div className="topbar ai-header-pulse">
        <div className="brand">
          <div className="logo">F</div>
          <div>
            <h1>FLOW</h1>
            <p>Business Process Intelligence</p>
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
              {t.id === "conflicts" && conflictPending && (
                <span className="badge-count">1</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {bootError && <div className="error">⚠ {bootError}</div>}

      {tab === "dashboard" && (
        <Dashboard
          workflows={workflows}
          onRefresh={refresh}
          onCreateWorkflow={handleWorkflowResult}
          triggerAiGlow={triggerAiGlow}
          justDeployed={justDeployed}
        />
      )}

      {tab === "memory" && <Explorer />}

      {tab === "conflicts" && (
        <Conflicts
          pending={pendingConflict}
          onAdopt={handleAdopt}
          onReject={handleReject}
          onNavigate={setTab}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "policies" && <Policies triggerAiGlow={triggerAiGlow} />}
    </div>
  );
}
