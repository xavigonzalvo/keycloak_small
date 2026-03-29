import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

function App() {
  const [auth, setAuth] = useState({ loggedIn: false, username: null, loading: true });

  useEffect(() => {
    fetch("/node-app/api/me")
      .then((r) => r.json())
      .then((data) => setAuth({ ...data, loading: false }))
      .catch(() => setAuth({ loggedIn: false, loading: false }));
  }, []);

  return (
    <BrowserRouter basename="/node-app">
      <div className="app">
        <nav>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/whoami">Who Am I</Link>
            <Link to="/public-info">Public</Link>
            <Link to="/certs">Certs</Link>
          </div>
          <div className="nav-auth">
            {auth.loading ? null : auth.loggedIn ? (
              <>
                <span className="username">{auth.username}</span>
                <a href="/node-app/logout" className="btn btn-logout">Log out</a>
              </>
            ) : (
              <a href="/node-app/login" className="btn btn-login">Log in</a>
            )}
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Home loggedIn={auth.loggedIn} />} />
            <Route path="/whoami" element={<WhoAmI />} />
            <Route path="/public-info" element={<PublicPage />} />
            <Route path="/certs" element={<CertsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Home({ loggedIn }) {
  return (
    <div>
      <h1>Example JWT App</h1>
      <p className="subtitle">Node.js + React</p>
      {loggedIn ? (
        <p>You are logged in. <Link to="/whoami">View your claims</Link>.</p>
      ) : (
        <p><a href="/node-app/login">Log in with Keycloak</a> to get started.</p>
      )}
      <h3>Endpoints</h3>
      <ul>
        <li><Link to="/public-info">/public</Link> &ndash; no auth required</li>
        <li><Link to="/whoami">/whoami</Link> &ndash; requires login</li>
        <li><code>GET /health</code> &ndash; liveness probe</li>
        <li><code>POST /api/data</code> &ndash; protected data endpoint</li>
      </ul>
    </div>
  );
}

function WhoAmI() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/node-app/api/whoami")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/node-app/login";
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
      <h2>Who Am I</h2>
      <p>Logged in as: <strong>{data.claims?.preferred_username}</strong></p>
      {data.header && (
        <>
          <h3>Token Header</h3>
          <p className="subtitle">
            Algorithm: <code>{data.header.alg}</code> &mdash; Key ID (kid): <code>{data.header.kid}</code>
          </p>
        </>
      )}
      <h3>JWT Claims</h3>
      <pre>{JSON.stringify(data.claims, null, 2)}</pre>
    </div>
  );
}

function PublicPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/node-app/api/public")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h2>Public Endpoint</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function CertsPage() {
  const [clientCert, setClientCert] = useState(null);
  const [clientCertError, setClientCertError] = useState(null);

  useEffect(() => {
    fetch("/node-app/api/client-cert")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setClientCert)
      .catch((e) => setClientCertError(e.message));
  }, []);

  const tdLabel = { padding: "4px 12px 4px 0", fontWeight: "bold", whiteSpace: "nowrap", verticalAlign: "top" };
  const card = { marginTop: "1.5rem", padding: "1rem", border: "1px solid #ddd", borderRadius: "6px" };

  return (
    <div>
      <h2>Your Client Certificate (mTLS)</h2>
      <p className="subtitle">
        This is the certificate your browser/device presented during the TLS
        handshake — the one from your Keychain / PIV card. nginx verified it
        and forwarded the identity to this app.
      </p>
      {clientCertError && <div className="error">Error: {clientCertError}</div>}
      {!clientCert && !clientCertError && <div className="loading">Loading...</div>}
      {clientCert && (
        clientCert.available ? (
          <div style={card}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                <tr><td style={tdLabel}>Verification</td><td><code>{clientCert.verify}</code></td></tr>
                <tr><td style={tdLabel}>Subject DN</td><td><code>{clientCert.subject_dn}</code></td></tr>
                <tr><td style={tdLabel}>Issuer DN</td><td><code>{clientCert.issuer_dn}</code></td></tr>
                <tr><td style={tdLabel}>Serial</td><td><code>{clientCert.serial}</code></td></tr>
                <tr><td style={tdLabel}>Not before</td><td>{clientCert.not_before}</td></tr>
                <tr><td style={tdLabel}>Not after</td><td>{clientCert.not_after}</td></tr>
                <tr><td style={tdLabel}>Fingerprint (SHA-1)</td><td style={{ wordBreak: "break-all" }}><code>{clientCert.fingerprint}</code></td></tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ ...card, background: "#fffbe6", borderColor: "#ffe58f" }}>
            <strong>Not available</strong> — {clientCert.note}
          </div>
        )
      )}
    </div>
  );
}

export default App;
