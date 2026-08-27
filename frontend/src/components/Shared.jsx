export function DepartmentBadge({ department }) {
  const d = (department || "Operations").trim();
  const cls = d.toLowerCase().replace(/\s+/g, "-");
  return <span className={`dept-badge dept-${cls}`}>{d}</span>;
}

export function Spinner() {
  return <span className="spinner" />;
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return <div className="error">⚠ {message}</div>;
}

export function StatusDot({ status }) {
  return (
    <span className={`status-pill status-${(status || "active").toLowerCase()}`}>
      <span className="status-dot-inner" />
      {status || "Active"}
    </span>
  );
}
