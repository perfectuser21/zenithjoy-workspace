#!/usr/bin/env bash
# Compatibility entry: current implementation contracts, isolated boundaries.
# Canonical required consumer: media-contracts-smoke.sh. No external delivery claim.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/media-contracts.mjs"
test -f "$runner"
exec node "$runner" api pg
