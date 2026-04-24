import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

function App() {
  const [auth, setAuth] = useState({ loggedIn: false, username: null, loading: true });

  useEffect(() => {
    fetch("/mtls-app/api/me")
      .then((r) => r.json())
      .then((data) => setAuth({ ...data, loading: false }))
      .catch(() => setAuth({ loggedIn: false, loading: false }));
  }, []);

  return (
    <BrowserRouter basename="/mtls-app">
      <div className="app">
        <nav>
          <div className="nav-brand">🔐 mTLS JWT</div>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/certificate">Certificate</Link>
            <Link to="/token">Token</Link>
          </div>
          <div className="nav-auth">
            {auth.loading ? null : auth.loggedIn ? (
              <>
                <span className="username">{auth.username}</span>
                <a href="/mtls-app/logout" className="btn btn-logout">Log out</a>
              </>
            ) : (
              <a href="/mtls-app/login" className="btn btn-login">Login with Certificate</a>
            )}
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Home loggedIn={auth.loggedIn} />} />
            <Route path="/certificate" element={<CertificatePage />} />
            <Route path="/token" element={<TokenPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Home({ loggedIn }) {
  return (
    <div>
      <h1>Passwordless mTLS Authentication</h1>
      <p className="subtitle">JWT issued by Keycloak based on your client certificate — no password required</p>

      <div className="flow-diagram">
        <div className="flow-step">
          <span className="step-num">1</span>
          <span className="step-text">Browser presents client certificate to nginx (mTLS handshake)</span>
        </div>
        <div className="flow-arrow">↓</div>
        <div className="flow-step">
          <span className="step-num">2</span>
          <span className="step-text">nginx validates cert and forwards it to Keycloak</span>
        </div>
        <div className="flow-arrow">↓</div>
        <div className="flow-step">
          <span className="step-num">3</span>
          <span className="step-text">Keycloak X.509 authenticator extracts identity from cert CN</span>
        </div>
        <div className="flow-arrow">↓</div>
        <div className="flow-step">
          <span className="step-num">4</span>
          <span className="step-text">Keycloak issues a JWT — no password prompt</span>
        </div>
      </div>

      {loggedIn ? (
        <div className="status-card success">
          <strong>✓ Authenticated</strong> — You are logged in via your client certificate.{" "}
          <Link to="/token">View your JWT claims</Link>.
        </div>
      ) : (
        <div className="status-card info">
          <strong>Not logged in</strong> —{" "}
          <a href="/mtls-app/login">Login with Certificate</a> to get a JWT without entering a password.
        </div>
      )}

      <h3>How it works</h3>
      <ul>
        <li><strong>mTLS</strong>: nginx verifies your client certificate during the TLS handshake</li>
        <li><strong>X.509 Authenticator</strong>: Keycloak reads the forwarded certificate and maps the CN to a user</li>
        <li><strong>OIDC</strong>: Standard authorization code flow — but the login step is automatic</li>
        <li><strong>JWT</strong>: The resulting access token is a standard Keycloak JWT</li>
      </ul>
    </div>
  );
}

function CertificatePage() {
  const [cert, setCert] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/mtls-app/api/cert-info")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setCert)
      .catch((e) => setError(e.message));
  }, []);

  const tdLabel = {
    padding: "6px 16px 6px 0",
    fontWeight: "600",
    whiteSpace: "nowrap",
    verticalAlign: "top",
    color: "#555",
  };

  return (
    <div>
      <h2>Your Client Certificate</h2>
      <p className="subtitle">
        This is the certificate your browser presented during the TLS handshake.
        nginx verified it and forwarded the identity to this app and to Keycloak.
      </p>
      {error && <div className="error">Error: {error}</div>}
      {!cert && !error && <div className="loading">Loading...</div>}
      {cert && (
        cert.available ? (
          <div className="card">
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                <tr><td style={tdLabel}>Verification</td><td><code>{cert.verify}</code></td></tr>
                <tr><td style={tdLabel}>Subject DN</td><td><code>{cert.subject_dn}</code></td></tr>
                <tr><td style={tdLabel}>Issuer DN</td><td><code>{cert.issuer_dn}</code></td></tr>
                <tr><td style={tdLabel}>Serial</td><td><code>{cert.serial}</code></td></tr>
                <tr><td style={tdLabel}>Not before</td><td>{cert.not_before}</td></tr>
                <tr><td style={tdLabel}>Not after</td><td>{cert.not_after}</td></tr>
                <tr><td style={tdLabel}>Fingerprint</td><td style={{ wordBreak: "break-all" }}><code>{cert.fingerprint}</code></td></tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="status-card warning">
            <strong>Not available</strong> — {cert.note}
          </div>
        )
      )}
    </div>
  );
}

function TokenPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/mtls-app/api/whoami")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/mtls-app/login";
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">Error: {error}</div>;
  if (!data) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h2>JWT from Certificate Authentication</h2>
      <p className="subtitle">{data.message}</p>

      <div className="status-card success">
        Logged in as: <strong>{data.claims?.preferred_username}</strong>
      </div>

      {data.header && (
        <>
          <h3>Token Header</h3>
          <pre>{JSON.stringify(data.header, null, 2)}</pre>
        </>
      )}

      <h3>JWT Claims</h3>
      <pre>{JSON.stringify(data.claims, null, 2)}</pre>
    </div>
  );
}

export default App;
