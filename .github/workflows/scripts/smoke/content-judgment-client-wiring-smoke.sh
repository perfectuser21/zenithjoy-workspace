#!/usr/bin/env bash
# Manual compatibility entry; required Android CI executes these JVM suites once.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/android-agent-contracts-smoke.sh"
test -f "$runner"
exec bash "$runner" "$@"
