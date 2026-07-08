#!/usr/bin/env bash
# ============================================================================
# core-regression-smoke.sh — feat PR 强制 smoke
# ----------------------------------------------------------------------------
# 跑 run-core-regression.sh 的 fixture 单测，确保值班表 runner 本身可靠。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

bash "$REPO_ROOT/scripts/ci/__tests__/run-core-regression.test.sh"

echo "=== core-regression-smoke PASS ==="
