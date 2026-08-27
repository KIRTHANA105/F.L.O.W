import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Dashboard from "./components/Dashboard";
import DecisionGate from "./components/DecisionGate";
import Conflicts from "./components/Conflicts";
import Explorer from "./components/Explorer";
import Policies from "./components/Policies";
import Simulation from "./components/Simulation";
import DependencyGraph from "./components/DependencyGraph";
import Auth from "./pages/Auth";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "memory", label: "Process Memory" },
  { id: "simulation", label: "Simulation" },
  { id: "graph", label: "Dependency Graph" },
  { id: "conflicts", label: "Conflicts" },
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
  // pendingDecision = { proposal, evaluation, rawText } — created by CreateWorkflowModal
  const [pendingDecision, setPendingDecision] = useState(null);
  const [lastSimReport, setLastSimReport] = useState(null);
  const [simWorkflowId, setSimWorkflowId] = useState(null);
  const glowTimer = useRef(null);

  const triggerAiGlow = useCallback((durationMs = 3000) => {
    setAiActive(true);
    clearTimeout(glowTimer.current);
    glowTimer.current = setTimeout(() => setAiActive(false), durationMs);
  }, []);

  const handleNavigateToSimulation = (wfId, scenarioCount) => {
    setSimWorkflowId(wfId);
    setTab("simulation");
  };

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
   * Lands directly on the DECISION GATE screen before activating.
   */
  const handleWorkflowResult = (result) => {
    setPendingDecision(result);
    setLastSimReport(null);
    setTab("gate");
  };

  /**
   * Called when a workflow is activated from the Decision Gate.
   */
  const handleAdopt = async (adoptedWorkflow, overrideLog) => {
    try {
      await api.adoptWorkflow(adoptedWorkflow.id, null, null);
    } catch (err) {
      console.error("Adoption call error", err);
    }
    await refresh();
    if (adoptedWorkflow?.name) {
      setJustDeployed(adoptedWorkflow.name);
      setTimeout(() => setJustDeployed(""), 8000);
    }
    setPendingDecision(null);
    setLastSimReport(null);
    setTab("dashboard");
  };

  /**
   * Called when a proposed workflow is rejected / discarded.
   */
  const handleReject = async () => {
    if (pendingDecision?.proposal?.id) {
      try {
        await api.rejectWorkflow(pendingDecision.proposal.id);
      } catch (err) {
        console.error("Reject call error", err);
      }
    }
    setPendingDecision(null);
    setLastSimReport(null);
    setTab("dashboard");
  };

  /**
   * Called from Simulation when returning to Decision Gate with results.
   */
  const handleReturnToDecision = (report) => {
    setLastSimReport(report);
    setTab("gate");
  };

  const decisionActive = !!pendingDecision;

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
          {decisionActive && (
            <button
              className={`tab ${tab === "gate" ? "active" : ""}`}
              onClick={() => setTab("gate")}
              style={{
                background: "rgba(99, 102, 241, 0.1)",
                color: "#6366f1",
                border: "1px solid #c7d2fe",
              }}
            >
              Decision Gate <span className="badge-count">1</span>
            </button>
          )}
        </div>
      </div>

      {bootError && <div className="error">⚠ {bootError}</div>}

      {tab === "dashboard" && (
        <Dashboard
          workflows={workflows}
          onRefresh={refresh}
          onCreateWorkflow={handleWorkflowResult}
          onAdopt={handleAdopt}
          onNavigateToSim={handleNavigateToSimulation}
          onRecalculate={handleWorkflowResult}
          triggerAiGlow={triggerAiGlow}
          justDeployed={justDeployed}
        />
      )}

      {tab === "gate" && (
        <DecisionGate
          pending={pendingDecision}
          lastSimReport={lastSimReport}
          onActivate={handleAdopt}
          onSimulate={handleNavigateToSimulation}
          onReject={handleReject}
          onRecalculate={handleWorkflowResult}
          onNavigate={(newTab, wfId) => {
            if (wfId) setSimWorkflowId(wfId);
            setTab(newTab);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "memory" && <Explorer />}

      {tab === "simulation" && (
        <Simulation
          initialWorkflowId={simWorkflowId}
          decisionPending={pendingDecision}
          onReturnToDecision={decisionActive ? handleReturnToDecision : null}
          onActivate={handleAdopt}
          onRecalculate={handleWorkflowResult}
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

      {tab === "conflicts" && (
        <Conflicts
          onNavigate={(newTab, wfId) => {
            if (wfId) setSimWorkflowId(wfId);
            setTab(newTab);
          }}
          triggerAiGlow={triggerAiGlow}
        />
      )}

      {tab === "policies" && <Policies triggerAiGlow={triggerAiGlow} />}
    </div>
  );
}
