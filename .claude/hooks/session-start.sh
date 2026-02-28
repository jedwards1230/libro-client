#!/bin/bash
# Hook: SessionStart
# Fires once when a fresh Claude Code session begins (not on resume).
#
# Installs bun if not present (needed for Claude Code Web ephemeral containers).
# Then runs bun install to ensure dependencies are up to date.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "[hook:session-start] Running in Claude Code Web (ephemeral container)"

  # Install bun if not present
  if ! command -v bun &>/dev/null; then
    echo "[hook:session-start] Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="/root/.bun/bin:${PATH}"
  else
    echo "[hook:session-start] bun already installed: $(bun --version)"
  fi
else
  echo "[hook:session-start] Running in local devcontainer — tools pre-installed"
fi

# Install dependencies
if [ -f "${CLAUDE_PROJECT_DIR}/package.json" ]; then
  echo "[hook:session-start] Running bun install..."
  cd "${CLAUDE_PROJECT_DIR}" && bun install
fi

echo "[hook:session-start] Done"
exit 0
