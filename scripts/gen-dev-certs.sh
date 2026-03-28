#!/usr/bin/env bash
# =============================================================================
# scripts/gen-dev-certs.sh
# Generates self-signed certificates for local development.
# NOT for production use.
# =============================================================================
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../nginx/certs" && pwd)"
mkdir -p "$CERTS_DIR"

echo "→ Generating certificates in $CERTS_DIR"

# -----------------------------------------------------------------------------
# 1. Local CA
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/ca.key" 4096

openssl req -x509 -new -nodes \
  -key "$CERTS_DIR/ca.key" \
  -sha256 -days 1825 \
  -subj "/CN=Local Dev CA/O=Dev/C=US" \
  -out "$CERTS_DIR/ca.crt"

echo "  ✓ CA created: ca.crt"

# -----------------------------------------------------------------------------
# 2. Server certificate for nginx
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/server.key" 2048

openssl req -new \
  -key "$CERTS_DIR/server.key" \
  -subj "/CN=localhost/O=Dev/C=US" \
  -out "$CERTS_DIR/server.csr"

openssl x509 -req \
  -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")

echo "  ✓ Server cert created: server.crt / server.key"

# -----------------------------------------------------------------------------
# 3. Test client certificate (simulates a PIV smart card)
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/client.key" 2048

openssl req -new \
  -key "$CERTS_DIR/client.key" \
  -subj "/CN=Test PIV User/O=Dev/C=US" \
  -out "$CERTS_DIR/client.csr"

openssl x509 -req \
  -in "$CERTS_DIR/client.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/client.crt" \
  -days 365 -sha256

echo "  ✓ Test client cert created: client.crt / client.key"

# Cleanup CSRs
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR"/*.srl

echo ""
echo "Done! You can now start the stack with:"
echo "  docker compose up --build"
echo ""
echo "To test with curl (mTLS + JWT):"
echo "  # 1. Get a token from Keycloak"
echo "  TOKEN=\$(curl -sk --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key \\"
echo "    --cacert $CERTS_DIR/ca.crt \\"
echo "    -X POST 'https://localhost/auth/realms/myrealm/protocol/openid-connect/token' \\"
echo "    -d 'grant_type=password&client_id=example-app&client_secret=example-app-secret&username=testuser&password=testpassword' \\"
echo "    | jq -r '.access_token')"
echo ""
echo "  # 2. Call the protected endpoint"
echo "  curl -sk --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key \\"
echo "    --cacert $CERTS_DIR/ca.crt \\"
echo "    -H \"Authorization: Bearer \$TOKEN\" \\"
echo "    https://localhost/app/whoami | jq"
