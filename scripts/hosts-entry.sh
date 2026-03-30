#!/usr/bin/env bash
# =============================================================================
# scripts/hosts-entry.sh
# Add or remove the APP_FQDN entry in /etc/hosts.
#
# Usage:
#   bash scripts/hosts-entry.sh add    [IP]   # adds the entry (requires sudo)
#   bash scripts/hosts-entry.sh remove [IP]   # removes the entry (requires sudo)
#   bash scripts/hosts-entry.sh status [IP]   # shows whether the entry exists
#
# IP defaults to 127.0.0.1 if omitted.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE" >&2
  exit 1
fi

FQDN="$(grep -oE 'APP_FQDN=.+' "$ENV_FILE" | cut -d= -f2)"

if [[ -z "$FQDN" ]]; then
  echo "Error: APP_FQDN not set in $ENV_FILE" >&2
  exit 1
fi

IP="${2:-127.0.0.1}"
HOSTS_LINE="${IP} ${FQDN}"
HOSTS_FILE="/etc/hosts"

case "${1:-}" in
  add)
    if grep -qF "$FQDN" "$HOSTS_FILE" 2>/dev/null; then
      echo "✓ Entry already exists: $HOSTS_LINE"
    else
      echo "Adding '$HOSTS_LINE' to $HOSTS_FILE (requires sudo)…"
      sudo sh -c "echo '$HOSTS_LINE' >> '$HOSTS_FILE'"
      echo "✓ Added."
    fi
    ;;
  remove)
    if grep -qF "$FQDN" "$HOSTS_FILE" 2>/dev/null; then
      echo "Removing '$FQDN' from $HOSTS_FILE (requires sudo)…"
      sudo sed -i '' "/^${IP//./\\.}[[:space:]]\\{1,\\}${FQDN}$/d" "$HOSTS_FILE"
      echo "✓ Removed."
    else
      echo "✓ No entry for $FQDN found — nothing to do."
    fi
    ;;
  status)
    if grep -qF "$FQDN" "$HOSTS_FILE" 2>/dev/null; then
      echo "✓ Entry exists: $(grep -F "$FQDN" "$HOSTS_FILE")"
    else
      echo "✗ No entry for $FQDN in $HOSTS_FILE"
    fi
    ;;
  *)
    echo "Usage: $0 {add|remove|status} [IP]" >&2
    exit 1
    ;;
esac
