#!/usr/bin/env bash
# Sync recent emails (read-only IMAP) and upload them into the sandbox.
# Meant for cron on the HOST (WSL), not inside the sandbox. Example crontab line:
#   */30 * * * * /path/to/agenda-assistant/sync/sync-and-upload.sh >> /path/to/agenda-assistant/sync/sync.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found (copy .env.example)"; exit 1; }

# Read single keys from .env without executing it as shell code.
cfg() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }

NODE_BIN="$(cfg NODE_BIN)";           NODE_BIN="${NODE_BIN:-node}"
OPENSHELL_BIN="$(cfg OPENSHELL_BIN)"; OPENSHELL_BIN="${OPENSHELL_BIN:-openshell}"
SANDBOX_NAME="$(cfg SANDBOX_NAME)"
SANDBOX_PROJECT_DIR="$(cfg SANDBOX_PROJECT_DIR)"
[ -n "$SANDBOX_NAME" ] && [ -n "$SANDBOX_PROJECT_DIR" ] || { echo "ERROR: set SANDBOX_NAME and SANDBOX_PROJECT_DIR in .env"; exit 1; }

# Never run two syncs at once (cron + manual run).
exec 9>"$HERE/.sync.lock"
flock -n 9 || { echo "another sync is running; skipping"; exit 0; }

STAGING="$HERE/staging"
rm -rf "$STAGING" && mkdir -p "$STAGING/mail"

# 1. Read-only IMAP sync -> staging/mail/inbox.json
"$NODE_BIN" "$HERE/sync-inbox.mjs" --out "$STAGING/mail/inbox.json"

# 2. Upload the "mail" folder -> <project>/data/mail/inbox.json inside the sandbox.
#    Only data/mail is touched; the calendar files in data/ are not uploaded.
"$OPENSHELL_BIN" sandbox upload "$SANDBOX_NAME" "$STAGING/mail" "$SANDBOX_PROJECT_DIR/data"

# 3. Best-effort check that the file arrived intact (uploads have damaged files before).
VERIFY="$HERE/staging/verify"
mkdir -p "$VERIFY"
if "$OPENSHELL_BIN" sandbox download "$SANDBOX_NAME" "$SANDBOX_PROJECT_DIR/data/mail/inbox.json" "$VERIFY" >/dev/null 2>&1; then
  GOT="$(find "$VERIFY" -name inbox.json | head -n 1)"
  if [ -n "$GOT" ] && cmp -s "$GOT" "$STAGING/mail/inbox.json"; then
    echo "[$(date -u +%FT%TZ)] upload verified"
  else
    echo "[$(date -u +%FT%TZ)] WARNING: uploaded inbox.json differs or was not found; check the sandbox copy"
  fi
else
  echo "[$(date -u +%FT%TZ)] note: could not download for verification (upload itself succeeded)"
fi
