#!/usr/bin/env bash
# =============================================================================
# scripts/gen-dev-certs.sh
# Orchestrator: generates all certificates for local development.
# NOT for production use.
#
# Delegates to:
#   gen-server-certs.sh  — server CA + nginx TLS cert
#   gen-client-certs.sh  — client CA + test PIV client cert
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$(cd "$SCRIPT_DIR/../nginx/certs" && pwd)"

bash "$SCRIPT_DIR/gen-server-certs.sh"
bash "$SCRIPT_DIR/gen-client-certs.sh"

echo ""
echo "Done! You can now start the stack with:"
echo "  docker compose up --build"
echo ""
echo "To test with curl (mTLS + JWT):"
echo "  # 1. Get a token from Keycloak"
echo "  TOKEN=\$(curl -sk --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key \\"
echo "    --cacert $CERTS_DIR/server-ca.crt \\"
echo "    -X POST 'https://localhost/auth/realms/myrealm/protocol/openid-connect/token' \\"
echo "    -d 'grant_type=password&client_id=example-app&client_secret=example-app-secret&username=testuser&password=testpassword' \\"
echo "    | jq -r '.access_token')"
echo ""
echo "  # 2. Call the protected endpoint"
echo "  curl -sk --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key \\"
echo "    --cacert $CERTS_DIR/server-ca.crt \\"
echo "    -H \"Authorization: Bearer \$TOKEN\" \\"
echo "    https://localhost/app/whoami | jq"
