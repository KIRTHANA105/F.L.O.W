import { useEffect, useRef } from "react";
import { DepartmentBadge } from "./Shared";

/**
 * Modal showing the full workflow detail: step sequence, business rules,
 * and connections to other workflows. Opened by clicking a workflow card.
 */
export default function WorkflowDetailModal({ workflow, onClose }) {
  const ref = useRef(null);

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === ref.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!workflow) return null;

  const connections = [
    ...(workflow.depends_on || []).map((c) => ({
      ...c,
      dir: "in",
      label: c.label || c.relationship,
    })),
    ...(workflow.leads_to || []).map((c) => ({
      ...c,
      dir: "out",
      label: c.label || c.relationship,
    })),
  ];

  return (
    <div className="modal-backdrop" ref={ref} onClick={handleBackdrop}>
      <div className="modal-panel workflow-detail-modal">
        <div className="modal-header">
          <div>
            <DepartmentBadge department={workflow.department} />
            <h2 className="modal-title">{workflow.name}</h2>
            <p className="modal-desc">{workflow.description}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Step flow */}
          <div className="modal-section">
            <div className="modal-section-label">Process Flow</div>
            <div className="step-flow">
              {(workflow.steps || []).map((step, i) => (
                <div key={i} className="step-flow-item">
                  <div className="step-node">
                    <div className="step-num">{i + 1}</div>
                    <div className="step-info">
                      <div className="step-name">{step.name}</div>
                      {step.description && (
                        <div className="step-desc">{step.description}</div>
                      )}
                    </div>
                  </div>
                  {i < (workflow.steps || []).length - 1 && (
                    <div className="step-connector" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Business rules */}
          {workflow.business_rules && workflow.business_rules.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-label">Business Rules</div>
              <div className="business-rules-list">
                {workflow.business_rules.map((rule, i) => (
                  <div key={i} className="business-rule-row">
                    <div className="rule-condition">
                      <span className="rule-icon">◆</span>
                      <span>{rule.condition}</span>
                    </div>
                    <div className="rule-arrow">→</div>
                    <div className="rule-path">{rule.path}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Process connections */}
          {connections.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-label">Process Connections</div>
              <div className="connections-list">
                {connections.map((c, i) => (
                  <div key={i} className={`connection-row ${c.dir}`}>
                    <span className="conn-arrow">
                      {c.dir === "in" ? "← " : "→ "}
                    </span>
                    <span className="conn-name">{c.name}</span>
                    <span className="conn-rel">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
