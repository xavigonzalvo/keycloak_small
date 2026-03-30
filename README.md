# Keycloak + mTLS Identity Wall

Reverse proxy (nginx) acting as an mTLS identity wall with PIV/smart-card
client certificates, backed by Keycloak as the IDP.  Applications behind
the wall consume JWT tokens issued by Keycloak.

## Architecture

```
Internet → nginx (mTLS, port 443)
              ├── /auth/*      → Keycloak (IDP)
              ├── /app/*       → example-app (Flask, JWT consumer)
              └── /node-app/*  → node-app (Node.js + React, JWT consumer)

Keycloak → Postgres (persistent storage)
```

| Service       | Internal port | Published (dev) | Purpose                          |
|---------------|---------------|------------------|----------------------------------|
| postgres      | 5432          | —                | Keycloak database                |
| keycloak      | 8080          | 8080             | Identity provider                |
| example-app   | 5000          | 5001             | Flask app (JWT consumer)         |
| node-app      | 3000          | 5002             | Node.js + React (JWT consumer)   |
| nginx         | 443 / 80      | 443 / 80         | mTLS reverse proxy               |

## Prerequisites

- Docker & Docker Compose v2+
- `openssl` (for generating dev certificates)
- `curl` and `python3` (for testing)

## Quick Start

### 1. Configure the local hostname

The stack uses the FQDN defined in `.env` (`APP_FQDN`, default
`ny.military.com`). Your machine needs to resolve that name to a local IP.

**Add the `/etc/hosts` entry** (defaults to `127.0.0.1`):

```bash
bash scripts/hosts-entry.sh add            # 127.0.0.1 ny.military.com
bash scripts/hosts-entry.sh add 10.0.1.50  # use a custom IP instead
```

**Check / remove later:**

```bash
bash scripts/hosts-entry.sh status
bash scripts/hosts-entry.sh remove
```

### 2. Generate development TLS certificates

```bash
bash scripts/gen-dev-certs.sh
```

This creates a self-signed CA, a server cert for nginx (with SANs for
`localhost` and `APP_FQDN`), and a test client cert (simulating a PIV
smart card) under `nginx/certs/`.

### 3. Trust the dev CA (macOS)

To avoid browser "untrusted certificate" warnings, add the generated
server CA to the macOS trust store:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  nginx/certs/server-ca.crt
```

To **remove** it later:

```bash
sudo security delete-certificate -c "Local Dev Server CA" \
  -t /Library/Keychains/System.keychain
```

### 4. Start the stack

```bash
docker compose up --build -d
```

Wait for Keycloak to become healthy (~60-90 s):

```bash
docker compose ps
```

All services should show `healthy` / `running`.

### 5. Pre-configured test credentials

The realm import (`keycloak/realms/myrealm.json`) creates everything
automatically on **first boot** (clean Postgres volume):

| Item              | Value                  |
|-------------------|------------------------|
| Realm             | `myrealm`             |
| Client ID (Flask) | `example-app`          |
| Client secret     | `example-app-secret`   |
| Client ID (Node)  | `node-app`             |
| Client secret     | `node-app-secret`      |
| Test user         | `testuser`             |
| Test password     | `testpassword`         |
| Admin user        | `admin`                |
| Admin password    | `admin_secret`         |
| Token lifespan    | 300 s (5 min)          |

## Testing (dev mode — bypassing nginx/mTLS)

Port 8080 (Keycloak), 5001 (Flask app), and 5002 (Node.js app) are
published directly for development convenience.

### Get an access token

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/myrealm/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=example-app" \
  -d "client_secret=example-app-secret" \
  -d "username=testuser" \
  -d "password=testpassword" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### Inspect the token

```bash
python3 -c "
import base64, json, sys
payload = '$TOKEN'.split('.')[1]
decoded = base64.urlsafe_b64decode(payload + '==')
print(json.dumps(json.loads(decoded), indent=2))
"
```

### Hit the app endpoints

```bash
# Public (no auth)
curl http://localhost:5001/public
curl http://localhost:5001/health

# Protected — decoded JWT claims
curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/whoami

# Protected + role check (needs 'user' or 'app-user' role)
curl -X POST http://localhost:5001/api/data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hello": "world"}'
```

### Negative tests

```bash
# No token → 401
curl http://localhost:5001/whoami

# Bad token → 401
curl -H "Authorization: Bearer invalid" http://localhost:5001/whoami
```

## Node.js + React App (dev mode)

The Node.js app runs on port **5002** and serves a React SPA with the
same JWT-based authentication as the Flask app.

### Browser login

1. Open http://localhost:5002
2. Click **Log in** — you'll be redirected to Keycloak
3. Log in with `testuser` / `testpassword`
4. After login, click **Who Am I** to view your JWT claims

### API testing with curl

```bash
# Get a token for the node-app client
NODE_TOKEN=$(curl -s -X POST http://localhost:8080/realms/myrealm/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=node-app" \
  -d "client_secret=node-app-secret" \
  -d "username=testuser" \
  -d "password=testpassword" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Public (no auth)
curl http://localhost:5002/api/public
curl http://localhost:5002/health

# Protected — decoded JWT claims
curl -H "Authorization: Bearer $NODE_TOKEN" http://localhost:5002/api/whoami

# Protected + role check
curl -X POST http://localhost:5002/api/data \
  -H "Authorization: Bearer $NODE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hello": "world"}'
```

## Testing through Nginx (mTLS)

After generating certs (step 1 above):

```bash
# Get a token directly from Keycloak (port 8080).
# We use the direct endpoint because Keycloak's issuer claim reflects the
# Host header it receives — tokens obtained through nginx would carry
# iss=http://localhost/realms/myrealm (no port), which doesn't match the
# app's KEYCLOAK_ISSUER (http://localhost:8080/realms/myrealm).
TOKEN=$(curl -s -X POST http://localhost:8080/realms/myrealm/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=example-app" \
  -d "client_secret=example-app-secret" \
  -d "username=testuser" \
  -d "password=testpassword" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Call the app through nginx (mTLS required)
curl -sk \
  --cert nginx/certs/client.crt --key nginx/certs/client.key \
  --cacert nginx/certs/ca.crt \
  -H "Authorization: Bearer $TOKEN" \
  https://localhost/app/whoami
```

> **Tip:** To skip mTLS during development, change `ssl_verify_client on;`
> to `ssl_verify_client optional_no_ca;` in `nginx/conf.d/default.conf`.

## Troubleshooting

### `Invalid audience` error from the app

The realm JSON includes an audience mapper that adds `example-app` to the
token's `aud` claim (and similarly `node-app` for the Node.js client).
This mapper is applied **only on first boot** when Keycloak imports the
realm into a clean database.

If you started the stack before the mapper was in the JSON (or modified the
realm in the Admin UI), Keycloak won't re-import it. Two options:

**Option A — Clean restart (easiest):**

```bash
docker compose down -v   # ⚠ destroys the Postgres volume
docker compose up --build -d
```

**Option B — Add the mapper manually via the Admin UI:**

1. Open http://localhost:8080/admin (admin / admin_secret)
2. Select realm **myrealm**
3. Go to **Clients → example-app → Client scopes**
4. Click **example-app-dedicated**
5. Click **Configure a new mapper → Audience**
6. Set *Included Client Audience* to `example-app`, enable
   *Add to access token*, save

### `KC_HOSTNAME` / issuer mismatch

The app validates the token's `iss` claim against `KEYCLOAK_ISSUER`
(set in `docker-compose.yml`). Both must resolve to the same URL.
If you change `KC_HOSTNAME`, update `KEYCLOAK_ISSUER` to match.

### Keycloak `/auth` path

Keycloak 17+ dropped the `/auth` prefix by default. The nginx config
proxies `/auth/` → `http://keycloak:8080/` (stripping the prefix), so
URLs like `https://localhost/auth/realms/myrealm/...` are forwarded
correctly. Direct access on port 8080 uses `/realms/...` without `/auth`.

## Keycloak Admin Console

http://localhost:8080/admin — log in with `admin` / `admin_secret`.
