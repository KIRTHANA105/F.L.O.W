// Port 8000 can be held by a stale socket on Windows; override with
// VITE_API_BASE (e.g. VITE_API_BASE=http://127.0.0.1:8010) without a code change.
const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8010";

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
  parse: (text, source_system) =>
    request("/api/parse", {
      method: "POST",
      body: JSON.stringify({ text, source_system }),
    }),
  simulate: (workflow) =>
    request("/api/simulate", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }),
  listWorkflows: () => request("/api/workflows"),
  createWorkflow: (workflow) =>
    request("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ workflow }),
    }),
  deleteWorkflow: (id) => request(`/api/workflows/${id}`, { method: "DELETE" }),
  scanConflicts: () => request("/api/conflicts", { method: "POST" }),
  explainConflict: (conflict) =>
    request("/api/explain-conflict", {
      method: "POST",
      body: JSON.stringify({ conflict }),
    }),
  resolveConflict: (rule_a, rule_b) =>
    request("/api/resolve-conflict", {
      method: "POST",
      body: JSON.stringify({ rule_a, rule_b }),
    }),
  applyFix: (fix) =>
    request("/api/apply-fix", {
      method: "POST",
      body: JSON.stringify({ fix }),
    }),
  memory: () => request("/api/memory"),
  policies: () => request("/api/policies"),
  createPolicy: (text) =>
    request("/api/policies", { method: "POST", body: JSON.stringify({ text }) }),
  togglePolicy: (id, active) =>
    request(`/api/policies/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),
  deletePolicy: (id) => request(`/api/policies/${id}`, { method: "DELETE" }),
  demoMode: () => request("/api/demo-mode"),
  setDemoMode: (enabled) =>
    request("/api/demo-mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  stats: () => request("/api/stats"),
  healthScore: () => request("/api/health-score"),
  reset: () => request("/api/reset", { method: "POST" }),
};
