// Port 8000 can be held by a stale socket on Windows; override with
// VITE_API_BASE (e.g. VITE_API_BASE=http://127.0.0.1:8010) without a code change.
const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8010";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  // --- Workflows (Dashboard) ---
  listWorkflows: (includeProposed = false) =>
    request(`/api/workflows${includeProposed ? "?include_proposed=true" : ""}`),
  getWorkflow: (id) => request(`/api/workflows/${id}`),
  deleteWorkflow: (id) => request(`/api/workflows/${id}`, { method: "DELETE" }),

  // --- New workflow creation: analyze → evaluate → adopt/reject ---
  analyze: (text) =>
    request("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  evaluate: (proposalId) =>
    request(`/api/evaluate/${proposalId}`, { method: "POST" }),

  explainEvaluation: (data) =>
    request("/api/evaluate/explain", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  adoptWorkflow: (proposalId, originWorkflowId, steps) =>
    request(`/api/workflows/${proposalId}/adopt`, {
      method: "POST",
      body: JSON.stringify({
        origin_workflow_id: originWorkflowId || null,
        steps: steps || null,
      }),
    }),

  updateWorkflowStatus: (workflowId, status) =>
    request(`/api/workflows/${workflowId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  rejectWorkflow: (proposalId) =>
    request(`/api/workflows/${proposalId}/reject`, { method: "POST" }),

  // --- Process Memory (graph) ---
  processMemory: () => request("/api/process-memory"),

  // --- Policy documents (upload .txt / .pdf) ---
  policyDocuments: () => request("/api/policy-documents"),

  uploadPolicyDocument: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${BASE}/api/policy-documents/upload`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        let detail = `Upload failed (${res.status})`;
        try {
          const body = await res.json();
          if (body.detail) detail = body.detail;
        } catch { /* non-JSON */ }
        throw new Error(detail);
      }
      return res.json();
    });
  },

  togglePolicyRule: (ruleId, active) =>
    request(`/api/policy-rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),

  deletePolicyRule: (ruleId) =>
    request(`/api/policy-rules/${ruleId}`, { method: "DELETE" }),

  // --- Simulation Engine ---
  simulateWorkflow: (workflowId) =>
    request(`/api/simulate/${workflowId}`, { method: "POST" }),
  getLastSimulation: (workflowId) =>
    request(`/api/simulate/${workflowId}/last`),

  // --- Workflow Dependency Graph ("Workflow X-Ray") ---
  getGraph: (workflowId) =>
    request(workflowId ? `/api/graph?workflow_id=${workflowId}` : "/api/graph"),

  // --- Post-Creation SVS Recommendation ---
  getRecommendation: (workflowId) =>
    request(`/api/recommendation/${workflowId}`),

  // --- Field-Level Conflicts ---
  getConflicts: () => request("/api/conflicts"),
  getWorkflowConflicts: (workflowId) => request(`/api/conflicts/${workflowId}`),
  seedSampleWorkflows: () =>
    request("/api/workflows/seed-samples", { method: "POST" }),

  // --- Meta / Demo ---
  getCatalog: () => request("/api/catalog"),
  stats: () => request("/api/stats"),
  demoMode: () => request("/api/demo-mode"),
  setDemoMode: (enabled) =>
    request("/api/demo-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  reset: () => request("/api/reset", { method: "POST" }),
  health: () => request("/api/health"),

  // --- AI Suggestions ---
  suggestAutomation: (text) =>
    request("/api/suggest-automation", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  suggestNextWorkflow: () =>
    request("/api/suggest-next-workflow", { method: "POST" }),
};
