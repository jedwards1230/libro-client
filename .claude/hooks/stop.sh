#!/bin/bash
# Hook: Stop
# Fires when Claude finishes generating a response.
# Runs TypeScript type-checking. Blocks (exit 2) on type errors.

set -euo pipefail

if [ -f "${CLAUDE_PROJECT_DIR}/tsconfig.json" ]; then
  if command -v bunx &>/dev/null; then
    if ! TSC_OUTPUT=$(cd "${CLAUDE_PROJECT_DIR}" && bunx tsc --noEmit 2>&1); then
      echo "TypeScript type errors found. Fix before continuing:" >&2
      echo "$TSC_OUTPUT" | tail -30 >&2
      exit 2
    fi
  fi
fi

exit 0
