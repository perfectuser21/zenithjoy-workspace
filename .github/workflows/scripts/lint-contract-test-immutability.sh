#!/usr/bin/env bash
# Sprint contracts remain immutable after introduction. Only a deletion with an
# exact historical-content anchor and seven-dimension retirement record can pass.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/validate-test-retirements.py" "${1:-origin/main}"
