#!/bin/bash
# Quick wrapper script for Jira ticket technical analysis
# Usage: ./analyze-tickets.sh DSH-5026 DSH-6226 ...

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/jira-technical-complexity.js" "$@"
