#!/bin/bash
# Hook: SessionStart
# Fires once when a fresh Claude Code session begins (not on resume).
#
# Installs bun if not present (needed for Claude Code Web ephemeral containers).
# Then runs bun install to ensure dependencies are up to date.

set +e  # Never exit on error in session-start

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  echo "[session-start] Running in Claude Code Web (ephemeral container)" >&2

  # Install bun if not present
  if ! command -v bun &>/dev/null; then
    echo "[session-start] Installing bun..." >&2
    curl -fsSL https://bun.sh/install | bash
    export PATH="/root/.bun/bin:${PATH}"
  else
    echo "[session-start] bun already installed: $(bun --version)" >&2
  fi
else
  echo "[session-start] Running in local devcontainer — tools pre-installed" >&2
fi

# Install dependencies
if [ -f "${CLAUDE_PROJECT_DIR}/package.json" ]; then
  echo "[session-start] Running bun install..." >&2
  cd "${CLAUDE_PROJECT_DIR}" && bun install
fi

echo "[session-start] Done" >&2
exit 0
