/**
 * app-mtls/server.js
 * ==================
 * Express application demonstrating passwordless JWT authentication
 * via mTLS client certificates + Keycloak X.509 authenticator.
 *
 * Flow:
 *   1. User connects with client cert → nginx validates cert
 *   2. User clicks "Login with Certificate"
 *   3. Browser redirects to Keycloak → X.509 authenticator reads cert
 *      from forwarded header → authenticates user without password
 *   4. Keycloak issues JWT → app validates it
 *
 * Endpoints
 * ---------
 * GET  /health        – liveness probe
 * GET  /api/public    – open endpoint
 * GET  /api/cert-info – mTLS certificate details from nginx headers
 * GET  /api/whoami    – JWT claims (auth required)
 * GET  /api/me        – session status
 * GET  /login         – redirect to Keycloak (X.509 auth)
 * GET  /callback      – OIDC authorization code exchange
 * GET  /logout        – end session
 * GET  *              – serve React SPA
 */

const express = require("express");
const session = require("express-session");
const path = require("path");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = 3000;
const KEYCLOAK_ISSUER =
  process.env.KEYCLOAK_ISSUER || "http://localhost:8080/realms/myrealm";
const JWKS_URI =
  process.env.JWKS_URI ||
  "http://keycloak:8080/realms/myrealm/protocol/openid-connect/certs";
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "RS256";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "mtls-app";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || "mtls-app";
const KEYCLOAK_CLIENT_SECRET =
  process.env.KEYCLOAK_CLIENT_SECRET || "mtls-app-secret";
const REDIRECT_URI =
  process.env.REDIRECT_URI || "http://localhost:5003/callback";
const TOKEN_ENDPOINT =
  process.env.TOKEN_ENDPOINT ||
  "http://keycloak:8080/realms/myrealm/protocol/openid-connect/token";
const SECRET_KEY =
  process.env.SECRET_KEY || "mtls-dev-secret-change-in-production";

// ---------------------------------------------------------------------------
// JWKS client (cached)
// ---------------------------------------------------------------------------
const client = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  rateLimit: true,
});

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// ---------------------------------------------------------------------------
// JWT validation helper
// ---------------------------------------------------------------------------
function validateToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: [JWT_ALGORITHM],
        audience: JWT_AUDIENCE,
        issuer: KEYCLOAK_ISSUER,
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(
  session({
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  })
);

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireAuth() {
  return async (req, res, next) => {
    let token = req.session.accessToken;
    if (!token) {
      const authHeader = req.headers.authorization || "";
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ", 2)[1];
      }
    }

    if (!token) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }

    try {
      req.claims = await validateToken(token);
      next();
    } catch (err) {
      req.session.accessToken = null;
      return res
        .status(401)
        .json({ error: `Token validation failed: ${err.message}` });
    }
  };
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/public", (_req, res) => {
  res.json({
    message: "Public endpoint — no token required.",
    app: "mtls-app",
  });
});

app.get("/api/cert-info", (req, res) => {
  const verify = req.headers["x-ssl-client-verify"];
  if (!verify) {
    return res.json({
      available: false,
      note: "No mTLS headers present. The request did not arrive via nginx mTLS proxy.",
    });
  }
  res.json({
    available: true,
    verify,
    subject_dn: req.headers["x-ssl-client-dn"] || null,
    issuer_dn: req.headers["x-ssl-client-issuer-dn"] || null,
    fingerprint: req.headers["x-ssl-client-fingerprint"] || null,
    serial: req.headers["x-ssl-client-serial"] || null,
    not_before: req.headers["x-ssl-client-notbefore"] || null,
    not_after: req.headers["x-ssl-client-notafter"] || null,
  });
});

app.get("/api/whoami", requireAuth(), async (req, res) => {
  const rawToken =
    req.session.accessToken ||
    (req.headers.authorization || "").replace("Bearer ", "");
  const decoded = jwt.decode(rawToken, { complete: true });
  res.json({
    message: "Authenticated via mTLS + Keycloak X.509 (no password)",
    header: decoded?.header || null,
    claims: req.claims,
  });
});

app.get("/api/me", async (req, res) => {
  if (req.session.accessToken) {
    try {
      const claims = await validateToken(req.session.accessToken);
      return res.json({ loggedIn: true, username: claims.preferred_username });
    } catch {
      req.session.accessToken = null;
    }
  }
  res.json({ loggedIn: false });
});

// ---------------------------------------------------------------------------
// Browser OIDC routes
// ---------------------------------------------------------------------------
app.get("/login", (_req, res) => {
  const authUrl = `${KEYCLOAK_ISSUER.replace(/\/+$/, "")}/protocol/openid-connect/auth`;
  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email roles",
  });
  res.redirect(`${authUrl}?${params}`);
});

app.get("/callback", async (req, res) => {
  const { error, error_description, code } = req.query;
  if (error) {
    return res.status(400).json({ error, description: error_description });
  }
  if (!code) {
    return res.status(400).json({ error: "No authorization code returned" });
  }

  try {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: KEYCLOAK_CLIENT_SECRET,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Token exchange failed:", text);
      return res
        .status(502)
        .json({ error: "Token exchange failed", detail: text });
    }

    const tokens = await resp.json();
    req.session.accessToken = tokens.access_token;
    req.session.idToken = tokens.id_token || "";
    res.redirect("/mtls-app/");
  } catch (err) {
    res
      .status(502)
      .json({ error: "Token exchange failed", detail: err.message });
  }
});

app.get("/logout", (req, res) => {
  const idToken = req.session.idToken;
  req.session.destroy(() => {
    const logoutUrl = `${KEYCLOAK_ISSUER.replace(/\/+$/, "")}/protocol/openid-connect/logout`;
    const homeUri = REDIRECT_URI.replace("/callback", "/");
    const params = new URLSearchParams({
      client_id: KEYCLOAK_CLIENT_ID,
      post_logout_redirect_uri: homeUri,
    });
    if (idToken) params.set("id_token_hint", idToken);
    res.redirect(`${logoutUrl}?${params}`);
  });
});

// ---------------------------------------------------------------------------
// Serve React frontend (static build)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`mTLS app listening on port ${PORT}`);
});
