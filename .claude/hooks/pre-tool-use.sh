#!/bin/bash
# Hook: PreToolUse
# Fires before every tool call. Receives the tool input as JSON on stdin.
# IMPORTANT: This fires on EVERY tool call. Keep it fast and silent.
# Exit 0 = allow, exit 2 = block (stderr message shown to Claude).

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)

# Example: block dangerous rm commands
# command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
# if [ "$tool_name" = "Bash" ] && echo "$command" | grep -q 'rm -rf /'; then
#   echo "Blocked: dangerous rm command" >&2
#   exit 2
# fi

exit 0
