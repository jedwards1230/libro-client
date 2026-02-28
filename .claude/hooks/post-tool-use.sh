#!/bin/bash
# Hook: PostToolUse
# Fires after every tool call. Receives the tool output as JSON on stdin.
# IMPORTANT: This fires on EVERY tool call. Keep it fast and silent.

set -euo pipefail

output=$(cat)

exit 0
