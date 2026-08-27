import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Spinner, ErrorNote } from "./Shared";

/**
 * Policies page — upload .txt or .pdf policy documents.
 * The system extracts checkable business rules from them.
 *
 * Conceptual model:
 *   Process Memory = how the company operates
 *   Policies = what the company is allowed / required to do
 *   Conflict Engine = do these align?
 */

const SAMPLE_POLICY = `Enterprise Customer Onboarding Policy

Enterprise customers must complete financial verification before onboarding begins. Customer Success may not hand off an account or begin implementation until Finance has confirmed payment terms and creditworthiness.`;

function RuleCard({ rule, onToggle, onDelete }) {
  const typeLabel = rule.compiled?.type === "require_precedes"
    ? `Requires "${rule.compiled.required_workflow}" before "${rule.compiled.before_step}"`
    : rule.compiled?.type === "informational"
    ? "Informational — not checked programmatically"
    : rule.compiled?.type || "";

  return (
    <div className={`rule-card${rule.active ? "" : " rule-inactive"}`}>
      <div className="rule-card-header">
        <span className="rule-card-title">{rule.title}</span>
        <div className="rule-card-actions">
          <button
            className="btn ghost btn-xs"
            onClick={() => onToggle(rule)}
            title={rule.active ? "Pause this rule" : "Reactivate this rule"}
          >
            {rule.active ? "● Active" : "○ Paused"}
          </button>
          <button
            className="btn ghost btn-xs"
            onClick={() => onDelete(rule)}
            title="Delete rule"
          >
            ✕
          </button>
        </div>
      </div>
      <p className="rule-card-text">"{rule.text}"</p>
      {typeLabel && (
        <div className="rule-card-type">{typeLabel}</div>
      )}
      <div className="rule-card-dept">
        <span className="rule-dept-pill">{rule.department}</span>
      </div>
    </div>
  );
}

function PolicyDocumentCard({ doc, onRuleToggle, onRuleDelete }) {
  const [open, setOpen] = useState(true);
  const rules = doc.rules || [];
  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div className="policy-doc-card">
      <button
        className="policy-doc-header"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="policy-doc-info">
          <span className="policy-doc-icon">§</span>
          <div>
            <div className="policy-doc-name">{doc.filename}</div>
            <div className="policy-doc-meta">
              {rules.length} rule{rules.length !== 1 ? "s" : ""} extracted ·{" "}
              {activeCount} active
            </div>
          </div>
        </div>
        <span className="policy-doc-toggle">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="policy-doc-rules">
          {rules.length === 0 ? (
            <div className="policy-empty-rules">
              No checkable rules extracted from this document.
            </div>
          ) : (
            rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={onRuleToggle}
                onDelete={onRuleDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Policies({ triggerAiGlow }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef(null);
  const dropRef = useRef(null);

  const load = async () => {
    try {
      const data = await api.policyDocuments();
      setDocs(data.documents || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["txt", "pdf"].includes(ext)) {
      setError("Only .txt and .pdf files are supported.");
      return;
    }
    triggerAiGlow?.();
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.uploadPolicyDocument(file);
      setSuccess(
        `"${result.filename}" uploaded — ${result.rules.length} rule${result.rules.length !== 1 ? "s" : ""} extracted.`
      );
      await load();
      setTimeout(() => setSuccess(""), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dropRef.current?.classList.remove("drag-over");
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    dropRef.current?.classList.add("drag-over");
  };

  const handleDragLeave = () => {
    dropRef.current?.classList.remove("drag-over");
  };

  const handleRuleToggle = async (rule) => {
    try {
      await api.togglePolicyRule(rule.id, !rule.active);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRuleDelete = async (rule) => {
    try {
      await api.deletePolicyRule(rule.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="policies-page">
      {/* Header */}
      <div className="policies-header">
        <div>
          <h2 className="section-heading">Company Policies</h2>
          <p className="section-sub">
            Upload policy documents that govern Nexora's operations. The system
            extracts checkable rules that are automatically evaluated when new
            workflows are proposed.
          </p>
        </div>
        <button className="btn ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Conceptual model */}
      <div className="policy-model-card">
        <div className="model-item">
          <div className="model-icon">⬡</div>
          <div className="model-label">Process Memory</div>
          <div className="model-desc">How the company operates</div>
        </div>
        <div className="model-sep">+</div>
        <div className="model-item">
          <div className="model-icon">§</div>
          <div className="model-label">Policies</div>
          <div className="model-desc">What it's allowed / required to do</div>
        </div>
        <div className="model-sep">→</div>
        <div className="model-item">
          <div className="model-icon">⟳</div>
          <div className="model-label">Conflict Engine</div>
          <div className="model-desc">Does a new workflow fit the business?</div>
        </div>
      </div>

      {/* Upload area */}
      <div className="card upload-card">
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Upload a policy document</h3>
        <p className="sub" style={{ margin: "0 0 20px" }}>
          Accepts <strong>.txt</strong> or <strong>.pdf</strong>. The system extracts
          business rules and compiles them for automatic checking.
        </p>

        <ErrorNote message={error} />
        {success && <div className="ok-banner" style={{ marginBottom: 16 }}>✓ {success}</div>}

        <div
          className="drop-zone"
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          {uploading ? (
            <div className="drop-uploading">
              <Spinner />
              <span>Extracting policy rules…</span>
            </div>
          ) : (
            <>
              <div className="drop-icon">↑</div>
              <div className="drop-label">
                Drag a file here or <span className="drop-link">click to browse</span>
              </div>
              <div className="drop-hint">.txt or .pdf · Max 5 MB</div>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.pdf"
          style={{ display: "none" }}
          onChange={handleFileInput}
        />
      </div>

      {/* Uploaded documents */}
      {!loaded ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <Spinner />
        </div>
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">§</div>
          <p>No policy documents uploaded yet.</p>
        </div>
      ) : (
        <div className="policy-docs-list">
          {docs.map((doc) => (
            <PolicyDocumentCard
              key={doc.id}
              doc={doc}
              onRuleToggle={handleRuleToggle}
              onRuleDelete={handleRuleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
