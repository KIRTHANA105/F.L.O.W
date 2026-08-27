const BASE = "http://127.0.0.1:8000";

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
  stats: () => request("/api/stats"),
  reset: () => request("/api/reset", { method: "POST" }),
};
