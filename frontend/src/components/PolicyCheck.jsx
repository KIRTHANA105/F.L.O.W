/**
 * Policy Check card (spec 4.3 step 4) - shown after parsing, before deploy.
 * Verdict comes from pure Python; the LLM never decides pass or fail.
 */
export default function PolicyCheck({ check }) {
  if (!check) return null;

  const { passed, violations = [], policies_checked } = check;

  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Policy Check</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Company policy applied to this rule before it goes live.
          </p>
        </div>
        <span className="pill-zero">
          Pure Python · <b>0</b> LLM calls
        </span>
      </div>

      {passed ? (
        <div className="ok-banner">
          ✓ Passes all {policies_checked} active polic
          {policies_checked === 1 ? "y" : "ies"}.
        </div>
      ) : (
        <>
          <div className="policy-fail-head">
            {violations.length} polic{violations.length === 1 ? "y" : "ies"}{" "}
            violated out of {policies_checked} checked
          </div>
          {violations.map((v, i) => (
            <div className={`policy-violation ${v.severity}`} key={i}>
              <span className={`violation-tag ${v.severity}`}>
                {v.severity === "block" ? "BLOCKS" : "WARNING"}
              </span>
              <div className="memory-body">
                <div className="memory-cap">§ {v.policy_text}</div>
                <div className="memory-src">{v.detail}</div>
              </div>
              <span className="memory-dept">{v.department}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
