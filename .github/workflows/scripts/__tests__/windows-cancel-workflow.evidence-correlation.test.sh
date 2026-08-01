#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/e2e-orphan-consolidation-windows.yml"

grep -Fq 'run-name: ${{ inputs.attempt_marker || github.workflow }}' "$WORKFLOW"
grep -Fq 'attempt_marker:' "$WORKFLOW"
grep -Fq "description: '调用方生成的唯一证据标记'" "$WORKFLOW"

echo "PASS: Windows cancel evidence dispatch has nonce correlation"
