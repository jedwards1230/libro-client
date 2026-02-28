#!/bin/bash
# Devcontainer entrypoint
# Runs after the container starts. Installs bun dependencies.

set -euo pipefail

WORKSPACE="/workspace"

echo "[entrypoint] Setting up libro-client devcontainer..."

# Install dependencies
if [ -f "${WORKSPACE}/package.json" ]; then
  echo "[entrypoint] Installing bun dependencies..."
  cd "${WORKSPACE}" && bun install
else
  echo "[entrypoint] No package.json found — skipping bun install"
fi

echo "[entrypoint] Devcontainer ready"
