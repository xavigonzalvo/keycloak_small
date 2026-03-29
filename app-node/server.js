/**
 * app-node/server.js
 * ==================
 * Minimal Express application that demonstrates JWT ingestion from Keycloak.
 *
 * Endpoints
 * ---------
 * GET  /health            – liveness probe (no auth required)
 * GET  /api/public        – open endpoint, no token needed
 * GET  /api/whoami        – returns the decoded JWT claims (auth required)
 * GET  /api/me            – session status check
 * POST /api/data          – protected data endpoint (auth required, role checked)
 * GET  /login             – redirect to Keycloak login
 * GET  /callback          – OIDC authorization code exchange
 * GET  /logout            – end session and redirect to Keycloak logout
 * GET  *                  – serve React SPA
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
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "node-app";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || "node-app";
const KEYCLOAK_CLIENT_SECRET =
  process.env.KEYCLOAK_CLIENT_SECRET || "node-app-secret";
const REDIRECT_URI =
  process.env.REDIRECT_URI || "http://localhost:5002/callback";
const TOKEN_ENDPOINT =
  process.env.TOKEN_ENDPOINT ||
  "http://keycloak:8080/realms/myrealm/protocol/openid-connect/token";
const SECRET_KEY =
  process.env.SECRET_KEY || "node-dev-secret-change-in-production";

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
// Auth middleware factory
// ---------------------------------------------------------------------------
function requireAuth(requiredRoles) {
  return async (req, res, next) => {
    // Check session first (browser login flow)
    let token = req.session.accessToken;
    if (!token) {
      // Fall back to Bearer header (API / curl flow)
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
      const claims = await validateToken(token);

      if (requiredRoles && requiredRoles.length > 0) {
        const realmRoles = (claims.realm_access || {}).roles || [];
        const resourceRoles =
          ((claims.resource_access || {})[JWT_AUDIENCE] || {}).roles || [];
        const granted = new Set([...realmRoles, ...resourceRoles]);
        if (!requiredRoles.some((r) => granted.has(r))) {
          return res.status(403).json({
            error: "Insufficient roles",
            required: requiredRoles,
            granted: [...granted],
          });
        }
      }

      req.claims = claims;
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
  res.json({ message: "This is a public endpoint. No token required." });
});

app.get("/api/whoami", requireAuth(), async (req, res) => {
  res.json({ message: "Token is valid", claims: req.claims });
});

app.post(
  "/api/data",
  requireAuth(["user", "app-user"]),
  async (req, res) => {
    res.json({
      message: "Data received",
      submitted_by: req.claims.preferred_username,
      roles: (req.claims.realm_access || {}).roles || [],
      data: req.body || {},
    });
  }
);

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
    res.redirect("/node-app/");
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
  console.log(`Node.js app listening on port ${PORT}`);
});
