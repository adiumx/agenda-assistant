#!/usr/bin/env bash
# Installs the Agenda Assistant into a NemoClaw / OpenClaw agent workspace.
#
# Run it INSIDE the sandbox, from anywhere:
#   bash /sandbox/.openclaw/workspace/agenda-assistant/install.sh
#
# What it does:
#   1. Backs up your current SOUL.md and TOOLS.md (only the first time).
#   2. Copies workspace/SOUL.md into the agent workspace and checks the copy.
#   3. Creates TOOLS.md with the real path of this project folder.
#   4. Runs the offline tests and resets the demo calendar.
#
# Options:  --yes   do not ask for confirmation
# Env:      OPENCLAW_WORKSPACE  agent workspace (default /sandbox/.openclaw/workspace)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${OPENCLAW_WORKSPACE:-/sandbox/.openclaw/workspace}"
BACKUP="$WORKSPACE/backup-before-agenda"
YES=0
[ "${1:-}" = "--yes" ] && YES=1

die() { echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null || die "node is not installed in this environment."
[ -d "$WORKSPACE" ] || die "agent workspace not found: $WORKSPACE (set OPENCLAW_WORKSPACE)."
[ -f "$HERE/workspace/SOUL.md" ] || die "missing $HERE/workspace/SOUL.md"
[ -f "$HERE/workspace/TOOLS.md" ] || die "missing $HERE/workspace/TOOLS.md"

echo "Project folder : $HERE"
echo "Agent workspace: $WORKSPACE"
echo "This REPLACES $WORKSPACE/SOUL.md and TOOLS.md (backups go to $BACKUP)."
if [ "$YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 1 ;; esac
fi

# 1. Backup (never overwrite an existing backup)
mkdir -p "$BACKUP"
for f in SOUL.md TOOLS.md; do
  if [ -f "$WORKSPACE/$f" ] && [ ! -f "$BACKUP/$f" ]; then
    cat "$WORKSPACE/$f" > "$BACKUP/$f"
    echo "backed up $f"
  fi
done

# 2. SOUL.md: plain cat copy, then verify byte by byte
cat "$HERE/workspace/SOUL.md" > "$WORKSPACE/SOUL.md"
cmp -s "$HERE/workspace/SOUL.md" "$WORKSPACE/SOUL.md" || die "SOUL.md copy does not match the original."
echo "installed SOUL.md"

# 3. TOOLS.md: fill in the real project path
sed "s|__PROJECT_DIR__|$HERE|g" "$HERE/workspace/TOOLS.md" > "$WORKSPACE/TOOLS.md"
grep -q "$HERE" "$WORKSPACE/TOOLS.md" || die "TOOLS.md was not written correctly."
echo "installed TOOLS.md"

# 4. Tests + clean demo state
echo "running tests..."
if ! (cd "$HERE" && node tools/test.mjs 2>&1 | grep -v -i undici | tail -n 3); then
  die "tests failed. If you see a JSON error, a data file may have been damaged during upload: compare 'md5sum data/*.json' with your original and upload again."
fi
(cd "$HERE" && node tools/agenda.mjs reset >/dev/null)
echo "demo calendar reset."

cat <<EOF

Done. Open a NEW agent session (SOUL.md and TOOLS.md load when a session starts) and write:

    Go through my inbox and update my calendar.

To restore your previous agent: cp "$BACKUP/SOUL.md" "$WORKSPACE/SOUL.md"; cp "$BACKUP/TOOLS.md" "$WORKSPACE/TOOLS.md"
EOF
