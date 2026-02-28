#!/bin/bash
# Hook: Stop
# Fires when Claude finishes generating a response.
#
# Runs TypeScript type-checking as a final quality check after Claude makes changes.

set -euo pipefail

if [ -f "${CLAUDE_PROJECT_DIR}/tsconfig.json" ]; then
  echo "[hook:stop] Running TypeScript type check..."
  if command -v bunx &>/dev/null; then
    cd "${CLAUDE_PROJECT_DIR}" && bunx tsc --noEmit 2>&1 | tail -30 || {
      echo "[hook:stop] TypeScript found type errors (exit code $?)"
      exit 2
    }
  else
    echo "[hook:stop] bunx not installed — skipping type check"
  fi
fi

exit 0
