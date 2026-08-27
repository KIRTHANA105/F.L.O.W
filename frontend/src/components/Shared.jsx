export function SourceBadge({ system }) {
  const key = (system || "Internal").toLowerCase();
  const cls = key === "erpnext" ? "erpnext" : key === "zoho" ? "zoho" : "internal";
  return <span className={`badge ${cls}`}>{system}</span>;
}

export function PriorityBadge({ priority }) {
  const p = (priority || "medium").toLowerCase();
  return <span className={`badge priority-${p}`}>{p.toUpperCase()}</span>;
}

export function Spinner() {
  return <span className="spinner" />;
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return <div className="error">⚠ {message}</div>;
}

export function summarize(items) {
  if (!items || items.length === 0) return "—";
  return items.map((i) => i.display).join(" · ");
}
