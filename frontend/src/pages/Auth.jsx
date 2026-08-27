import { useState } from "react";

const initialSignup = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  company: "",
  size: "",
  role: "",
};

function Field({ label, ...props }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

function SelectField({ label, children, ...props }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <select {...props}>
        <option value="">Select an option</option>
        {children}
      </select>
    </label>
  );
}

export default function Auth({ onSuccess, triggerAiGlow }) {
  const [mode, setMode] = useState("login");
  const [login, setLogin] = useState({ email: "", password: "" });
  const [signup, setSignup] = useState(initialSignup);
  const [error, setError] = useState("");

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
  };

  const updateLogin = (event) => {
    setLogin({ ...login, [event.target.name]: event.target.value });
  };

  const updateSignup = (event) => {
    setSignup({ ...signup, [event.target.name]: event.target.value });
  };

  const submitLogin = (event) => {
    event.preventDefault();
    if (
      !login.email.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.email)
    ) {
      setError("Enter a valid work email.");
      return;
    }
    if (login.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    triggerAiGlow(3000);
    const savedUser = JSON.parse(localStorage.getItem("flow_user") || "null");
    onSuccess(
      savedUser || { name: login.email.split("@")[0], email: login.email },
      "login",
    );
  };

  const submitSignup = (event) => {
    event.preventDefault();
    if (!signup.name.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signup.email)) {
      setError("Enter a valid work email.");
      return;
    }
    if (signup.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (signup.password !== signup.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const user = {
      name: signup.name,
      email: signup.email,
      company: signup.company,
      role: signup.role,
    };
    localStorage.setItem("flow_user", JSON.stringify(user));
    triggerAiGlow(3000);
    onSuccess(user, "signup");
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">F</div>
          <div className="auth-wordmark">FLOW</div>
          <div className="auth-tagline">Rule Intelligence · Copilot</div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
            type="button"
          >
            Log in
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => switchMode("signup")}
            type="button"
          >
            Sign up
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {mode === "login" ? (
          <form className="auth-form" onSubmit={submitLogin}>
            <Field
              label="Work Email"
              name="email"
              type="email"
              placeholder="you@company.com"
              value={login.email}
              onChange={updateLogin}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              placeholder="••••••••"
              value={login.password}
              onChange={updateLogin}
            />
            <div className="forgot-link">Forgot password?</div>
            <button className="auth-submit" type="submit">
              Log in
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitSignup}>
            <Field
              label="Full Name"
              name="name"
              placeholder="Jane Smith"
              value={signup.name}
              onChange={updateSignup}
            />
            <Field
              label="Work Email"
              name="email"
              type="email"
              placeholder="you@company.com"
              value={signup.email}
              onChange={updateSignup}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              placeholder="••••••••"
              value={signup.password}
              onChange={updateSignup}
            />
            <Field
              label="Confirm Password"
              name="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={signup.confirmPassword}
              onChange={updateSignup}
            />
            <SelectField
              label="Company Type"
              name="company"
              value={signup.company}
              onChange={updateSignup}
            >
              {[
                "SaaS",
                "E-commerce",
                "Manufacturing",
                "Logistics",
                "Healthcare",
                "Finance",
                "Other",
              ].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </SelectField>
            <SelectField
              label="Company Size"
              name="size"
              value={signup.size}
              onChange={updateSignup}
            >
              {["1–10", "11–50", "51–200", "201–1000", "1000+"].map(
                (option) => (
                  <option key={option}>{option}</option>
                ),
              )}
            </SelectField>
            <SelectField
              label="Role"
              name="role"
              value={signup.role}
              onChange={updateSignup}
            >
              {[
                "Operations Manager",
                "Business Analyst",
                "CTO",
                "Developer",
                "Finance Lead",
                "Other",
              ].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </SelectField>
            <button className="auth-submit" type="submit">
              Create account →
            </button>
          </form>
        )}

        <div className="auth-terms">
          By signing up you agree to the Terms of Service
        </div>
      </section>
      <p className="auth-trusted">
        Trusted by operations teams across ERPNext · Zoho · Internal systems
      </p>
    </main>
  );
}
