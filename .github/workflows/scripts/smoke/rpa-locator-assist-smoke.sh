#!/usr/bin/env bash
# Offline actual router/service/PG/provider contracts; paid quality probe is operator-only.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/media-extra-contracts.mjs"
test -f "$runner"
exec node "$runner"
