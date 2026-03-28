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

import os
import logging

import requests
from flask import Flask, jsonify, request, g
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

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)

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
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "Missing or invalid Authorization header"}), 401

            token = auth_header.split(" ", 1)[1]
            try:
                claims = _validate_token(token)
            except ValueError as exc:
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
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
