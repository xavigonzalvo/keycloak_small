#!/usr/bin/env bash
# =============================================================================
# scripts/gen-client-certs.sh
# Generates the client CA and a test PIV client certificate for local development.
# NOT for production use.
# =============================================================================
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../nginx/certs" && pwd)"
mkdir -p "$CERTS_DIR"

echo "→ Generating client certificates in $CERTS_DIR"

# -----------------------------------------------------------------------------
# 1. Client CA
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/client-ca.key" 4096

openssl req -x509 -new -nodes \
  -key "$CERTS_DIR/client-ca.key" \
  -sha256 -days 1825 \
  -subj "/CN=Local Dev Client CA/O=Dev/C=US" \
  -out "$CERTS_DIR/client-ca.crt"

echo "  ✓ Client CA created: client-ca.crt"

# -----------------------------------------------------------------------------
# 2. Test client certificate — simulates a PIV smart card (signed by Client CA)
# -----------------------------------------------------------------------------
openssl genrsa -out "$CERTS_DIR/client.key" 2048

openssl req -new \
  -key "$CERTS_DIR/client.key" \
  -subj "/CN=Test PIV User/O=Dev/C=US" \
  -out "$CERTS_DIR/client.csr"

openssl x509 -req \
  -in "$CERTS_DIR/client.csr" \
  -CA "$CERTS_DIR/client-ca.crt" \
  -CAkey "$CERTS_DIR/client-ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/client.crt" \
  -days 365 -sha256

echo "  ✓ Test client cert created: client.crt / client.key"

# -----------------------------------------------------------------------------
# 3. PKCS#12 bundle for macOS Keychain / browser import
# -----------------------------------------------------------------------------
openssl pkcs12 -export \
  -out "$CERTS_DIR/client.p12" \
  -inkey "$CERTS_DIR/client.key" \
  -in "$CERTS_DIR/client.crt" \
  -certfile "$CERTS_DIR/client-ca.crt" \
  -passout pass:changeit

echo "  ✓ PKCS#12 bundle created: client.p12 (password: changeit)"

# Cleanup
rm -f "$CERTS_DIR/client.csr" "$CERTS_DIR/client-ca.srl"
