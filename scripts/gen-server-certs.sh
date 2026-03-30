#!/usr/bin/env bash
# =============================================================================
# scripts/gen-server-certs.sh
# Generates the server CA and nginx server certificate for local development.
# NOT for production use.
# =============================================================================
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../nginx/certs" && pwd)"
mkdir -p "$CERTS_DIR"

echo "→ Generating server certificates in $CERTS_DIR"

# -----------------------------------------------------------------------------
# 1. Server CA
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/server-ca.key" 4096

openssl req -x509 -new -nodes \
  -key "$CERTS_DIR/server-ca.key" \
  -sha256 -days 1825 \
  -subj "/CN=Local Dev Server CA/O=Dev/C=US" \
  -out "$CERTS_DIR/server-ca.crt"

echo "  ✓ Server CA created: server-ca.crt"

# -----------------------------------------------------------------------------
# 2. Server certificate for nginx (signed by Server CA)
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/server.key" 2048

openssl req -new \
  -key "$CERTS_DIR/server.key" \
  -subj "/CN=localhost/O=Dev/C=US" \
  -out "$CERTS_DIR/server.csr"

openssl x509 -req \
  -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/server-ca.crt" \
  -CAkey "$CERTS_DIR/server-ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")

echo "  ✓ Server cert created: server.crt / server.key"

# Cleanup
rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/server-ca.srl"
