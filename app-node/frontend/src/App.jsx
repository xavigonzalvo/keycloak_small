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

export default App;
