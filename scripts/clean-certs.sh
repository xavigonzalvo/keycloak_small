#!/usr/bin/env bash
# =============================================================================
# scripts/clean-certs.sh
# Removes all generated certificate files from nginx/certs/.
# Preserves the README.md.
# =============================================================================
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../nginx/certs" && pwd)"

echo "→ Cleaning generated certs in $CERTS_DIR"

rm -f \
  "$CERTS_DIR/server-ca.key" "$CERTS_DIR/server-ca.crt" \
  "$CERTS_DIR/server.key"    "$CERTS_DIR/server.crt"     \
  "$CERTS_DIR/client-ca.key" "$CERTS_DIR/client-ca.crt"  \
  "$CERTS_DIR/client.key"    "$CERTS_DIR/client.crt"     \
  "$CERTS_DIR/client.p12"    \
  "$CERTS_DIR/pivuser.key"   "$CERTS_DIR/pivuser.crt"    \
  "$CERTS_DIR/pivuser.p12"   \
  "$CERTS_DIR/ca.key"        "$CERTS_DIR/ca.crt"         \
  "$CERTS_DIR/client.csr"    "$CERTS_DIR/pivuser.csr"    \
  "$CERTS_DIR/client-ca.srl" \
  "$CERTS_DIR/server.csr"    "$CERTS_DIR/server-ca.srl"

echo "  ✓ All generated certificates removed"
