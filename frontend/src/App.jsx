import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Dashboard from "./components/Dashboard";
import Policies from "./components/Policies";
import Simulation from "./components/Simulation";
import DependencyGraph from "./components/DependencyGraph";
import Auth from "./pages/Auth";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "simulation", label: "Simulation" },
  { id: "graph", label: "Dependency Graph" },
  { id: "policies", label: "Policies" },
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [workflows, setWorkflows] = useState([]);
  const [bootError, setBootError] = useState("");
  const [aiActive, setAiActive] = useState(false);
  const [welcome, setWelcome] = useState("");
  const [justDeployed, setJustDeployed] = useState("");
  // pendingProposal = { proposal, evaluation, rawText } — created by CreateWorkflowModal,
  // consumed once by Simulation so a fresh proposal doesn't need a re-fetch.
  const [pendingProposal, setPendingProposal] = useState(null);
  const [simWorkflowId, setSimWorkflowId] = useState(null);
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
      const wf = await api.listWorkflows(true);
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
   * Called by CreateWorkflowModal once analyze + evaluate finish.
   * We stay on the Dashboard so the user sees the new "CREATED" card.
   * The user then navigates to Simulation manually via the card detail modal.
   */
  const handleWorkflowResult = async (result) => {
    setPendingProposal(result);
    setSimWorkflowId(result.proposal.id);
    // Refresh dashboard to show the new "created" card — do NOT auto-navigate.
    await refresh();
  };

  const handleNavigateToSimulation = async (wfId) => {
    if (wfId) setSimWorkflowId(wfId);
    await refresh();
    setTab("simulation");
  };

  const handleAdopted = async (workflow) => {
    await refresh();
    if (workflow?.name) {
      setJustDeployed(workflow.name);
      setTimeout(() => setJustDeployed(""), 8000);
    }
    setPendingProposal(null);
    setTab("dashboard");
  };

  // Direct-execution shortcut from the workflow detail modal (no simulation).
  const handleDirectAdopt = async (workflow) => {
    const adopted = await api.adoptWorkflow(workflow.id, null, null);
    await handleAdopted(adopted.workflow);
  };

  const handleRejected = async () => {
    setPendingProposal(null);
    await refresh();
  };

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
          onAdopt={handleDirectAdopt}
          onRecalculate={handleWorkflowResult}
          onNavigateToSim={handleNavigateToSimulation}
          triggerAiGlow={triggerAiGlow}
          justDeployed={justDeployed}
        />
      )}

      {tab === "simulation" && (
        <Simulation
          initialWorkflowId={simWorkflowId}
          pendingProposal={pendingProposal}
          onAdopted={handleAdopted}
          onRejected={handleRejected}
          onNavigate={(newTab, wfId) => {
            if (wfId) setSimWorkflowId(wfId);
            setTab(newTab);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "graph" && (
        <DependencyGraph
          onNavigateToSimulation={handleNavigateToSimulation}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "policies" && <Policies triggerAiGlow={triggerAiGlow} />}
    </div>
  );
}
