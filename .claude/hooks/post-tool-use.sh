#!/bin/bash
# Hook: PostToolUse
# Fires after every tool call. Receives the tool output as JSON on stdin.
#
# Stub — no post-tool action needed for libro-client development.

set -euo pipefail

# Read stdin to avoid broken pipe
output=$(cat)
tool_name=$(echo "$output" | jq -r '.tool_name // empty' 2>/dev/null || true)

echo "[hook:post-tool-use] tool=$tool_name"

exit 0
