"""
example_app/app.py
==================
Minimal Flask application that demonstrates JWT ingestion from Keycloak.

Endpoints
---------
GET  /health            – liveness probe (no auth required)
GET  /                  – redirect to /whoami
GET  /whoami            – returns the decoded JWT claims (auth required)
GET  /public            – open endpoint, no token needed
POST /api/data          – protected data endpoint (auth required, role checked)
"""

import json
import os
import logging
from urllib.parse import urlencode

import requests
from flask import Flask, jsonify, request, g, session, redirect, url_for
from functools import wraps
from jose import jwt, JWTError, jwk
from jose.utils import base64url_decode

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
KEYCLOAK_ISSUER = os.environ.get(
    "KEYCLOAK_ISSUER",
    "http://localhost/auth/realms/myrealm",
)
JWKS_URI = os.environ.get(
    "JWKS_URI",
    "http://keycloak:8080/realms/myrealm/protocol/openid-connect/certs",
)
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "RS256")
JWT_AUDIENCE  = os.environ.get("JWT_AUDIENCE", "example-app")

KEYCLOAK_CLIENT_ID     = os.environ.get("KEYCLOAK_CLIENT_ID", "example-app")
KEYCLOAK_CLIENT_SECRET = os.environ.get("KEYCLOAK_CLIENT_SECRET", "example-app-secret")
REDIRECT_URI           = os.environ.get("REDIRECT_URI", "http://localhost:5001/callback")
TOKEN_ENDPOINT         = os.environ.get("TOKEN_ENDPOINT", "http://keycloak:8080/realms/myrealm/protocol/openid-connect/token")
SECRET_KEY             = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = SECRET_KEY

# ---------------------------------------------------------------------------
# JWKS cache (simple in-memory; replace with a proper cache in production)
# ---------------------------------------------------------------------------
_jwks_cache: dict = {}


def _fetch_jwks() -> dict:
    """Fetch the JSON Web Key Set from Keycloak and cache it."""
    global _jwks_cache
    if not _jwks_cache:
        log.info("Fetching JWKS from %s", JWKS_URI)
        resp = requests.get(JWKS_URI, timeout=5)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


# ---------------------------------------------------------------------------
# JWT validation helper
# ---------------------------------------------------------------------------
def _validate_token(token: str) -> dict:
    """
    Validate a Bearer JWT issued by Keycloak.

    Returns the decoded payload dict on success.
    Raises ValueError with a human-readable message on failure.
    """
    try:
        jwks = _fetch_jwks()
        payload = jwt.decode(
            token,
            jwks,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=KEYCLOAK_ISSUER,
            options={"verify_at_hash": False},
        )
        return payload
    except JWTError as exc:
        raise ValueError(f"Token validation failed: {exc}") from exc
    except requests.RequestException as exc:
        raise ValueError(f"Could not reach JWKS endpoint: {exc}") from exc


# ---------------------------------------------------------------------------
# Auth decorator
# ---------------------------------------------------------------------------
def require_auth(required_roles: list[str] | None = None):
    """
    Decorator that enforces a valid Bearer JWT on every request.

    Optionally checks that the token contains at least one of `required_roles`
    in the `realm_access.roles` claim.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # Check session first (browser login flow)
            token = session.get("access_token")
            if not token:
                # Fall back to Bearer header (API / curl flow)
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header.split(" ", 1)[1]

            if not token:
                if "text/html" in request.headers.get("Accept", ""):
                    return redirect(url_for("login"))
                return jsonify({"error": "Missing or invalid Authorization header"}), 401

            try:
                claims = _validate_token(token)
            except ValueError as exc:
                session.pop("access_token", None)
                if "text/html" in request.headers.get("Accept", ""):
                    return redirect(url_for("login"))
                return jsonify({"error": str(exc)}), 401

            if required_roles:
                realm_roles = claims.get("realm_access", {}).get("roles", [])
                resource_roles = (
                    claims.get("resource_access", {})
                          .get(JWT_AUDIENCE, {})
                          .get("roles", [])
                )
                granted = set(realm_roles) | set(resource_roles)
                if not granted.intersection(required_roles):
                    return jsonify({"error": "Insufficient roles", "required": required_roles, "granted": list(granted)}), 403

            g.claims = claims
            return f(*args, **kwargs)
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/")
def index():
    if "text/html" in request.headers.get("Accept", ""):
        logged_in = "access_token" in session
        action = (
            "<p><a class='btn' href='/whoami'>View My Claims</a> "
            "<a class='btn logout' href='/logout'>Log out</a></p>"
            if logged_in else
            "<p><a class='btn' href='/login'>Log in with Keycloak</a></p>"
        )
        return (
            "<!DOCTYPE html><html><head><title>Example App</title><style>"
            "body{font-family:sans-serif;padding:2em;max-width:600px;margin:auto}"
            "a.btn{display:inline-block;padding:.5em 1.5em;background:#0066cc;color:white;"
            "text-decoration:none;border-radius:4px;margin:.5em .25em}"
            "a.btn.logout{background:#cc3300}"
            "</style></head><body>"
            "<h1>Example JWT App</h1>" + action +
            "<h3>Endpoints</h3><ul>"
            "<li><a href='/public'>/public</a> &#8211; no auth required</li>"
            "<li><a href='/whoami'>/whoami</a> &#8211; requires login</li>"
            "<li><a href='/health'>/health</a> &#8211; liveness probe</li>"
            "</ul></body></html>"
        )
    return jsonify({
        "message": "Example JWT Application",
        "endpoints": {
            "GET /health":    "Liveness probe – no auth",
            "GET /public":    "Public endpoint – no auth",
            "GET /whoami":    "Returns your decoded JWT claims",
            "POST /api/data": "Protected data endpoint",
        }
    })


@app.route("/public")
def public():
    return jsonify({"message": "This is a public endpoint. No token required."})


@app.route("/whoami")
@require_auth()
def whoami():
    """Return the full decoded JWT payload back to the caller."""
    if "text/html" in request.headers.get("Accept", ""):
        username = g.claims.get("preferred_username", "unknown")
        claims_json = json.dumps(g.claims, indent=2)
        return (
            "<!DOCTYPE html><html><head><title>Who Am I</title><style>"
            "body{font-family:monospace;padding:2em;max-width:800px;margin:auto}"
            "pre{background:#f4f4f4;padding:1em;border-radius:4px;overflow-x:auto}"
            "a{color:#0066cc;text-decoration:none}"
            "a.btn{display:inline-block;padding:.4em 1.2em;background:#cc3300;"
            "color:white;border-radius:4px;margin-left:1em}"
            "</style></head><body>"
            f"<h2>Logged in as: {username}</h2>"
            "<p><a href='/'>Home</a> <a class='btn' href='/logout'>Log out</a></p>"
            f"<h3>JWT Claims</h3><pre>{claims_json}</pre>"
            "</body></html>"
        )
    return jsonify({
        "message": "Token is valid",
        "claims": g.claims,
    })


@app.route("/api/data", methods=["POST"])
@require_auth(required_roles=["user", "app-user"])
def api_data():
    """
    Protected endpoint that accepts arbitrary JSON.
    Requires the caller to have the 'user' or 'app-user' role.
    """
    body = request.get_json(silent=True) or {}
    return jsonify({
        "message": "Data received",
        "submitted_by": g.claims.get("preferred_username"),
        "roles": g.claims.get("realm_access", {}).get("roles", []),
        "data": body,
    }), 200


# ---------------------------------------------------------------------------
# Browser OIDC routes
# ---------------------------------------------------------------------------
@app.route("/login")
def login():
    auth_url = KEYCLOAK_ISSUER.rstrip("/") + "/protocol/openid-connect/auth"
    params = urlencode({
        "client_id":     KEYCLOAK_CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid profile email roles",
    })
    return redirect(f"{auth_url}?{params}")


@app.route("/callback")
def callback():
    error = request.args.get("error")
    if error:
        return jsonify({"error": error, "description": request.args.get("error_description")}), 400
    code = request.args.get("code")
    if not code:
        return jsonify({"error": "No authorization code returned"}), 400

    resp = requests.post(TOKEN_ENDPOINT, data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  REDIRECT_URI,
        "client_id":     KEYCLOAK_CLIENT_ID,
        "client_secret": KEYCLOAK_CLIENT_SECRET,
    }, timeout=10)
    if not resp.ok:
        log.error("Token exchange failed: %s", resp.text)
        return jsonify({"error": "Token exchange failed", "detail": resp.text}), 502

    tokens = resp.json()
    session["access_token"] = tokens["access_token"]
    session["id_token"]     = tokens.get("id_token", "")
    return redirect(url_for("whoami"))


@app.route("/logout")
def logout():
    id_token = session.pop("id_token", None)
    session.pop("access_token", None)
    logout_url = KEYCLOAK_ISSUER.rstrip("/") + "/protocol/openid-connect/logout"
    home_uri = REDIRECT_URI.rsplit("/callback", 1)[0] + "/"
    params = {"client_id": KEYCLOAK_CLIENT_ID, "post_logout_redirect_uri": home_uri}
    if id_token:
        params["id_token_hint"] = id_token
    return redirect(logout_url + "?" + urlencode(params))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
