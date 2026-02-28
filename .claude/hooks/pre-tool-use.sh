#!/bin/bash
# Hook: PreToolUse
# Fires before every tool call. Receives the tool input as JSON on stdin.
#
# Logs the tool name for auditing. Exits 0 to allow all tool calls to proceed.
#
# Exit codes:
#   0 — allow the tool call to proceed
#   2 — block the tool call (Claude sees your stderr output as the reason)

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)

echo "[hook:pre-tool-use] tool=$tool_name"

exit 0
