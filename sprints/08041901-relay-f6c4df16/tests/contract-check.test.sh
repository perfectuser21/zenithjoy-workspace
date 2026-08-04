#!/usr/bin/env bash
# Contract E2E test — delegates to contract-check.sh
# Named *.test.sh so harness judge can discover it.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/contract-check.sh"
