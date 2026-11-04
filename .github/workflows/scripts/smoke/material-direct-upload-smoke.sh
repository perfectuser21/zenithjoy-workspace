#!/usr/bin/env bash
# Compatibility entry: current implementation contracts, isolated boundaries.
# Canonical required consumer: media-contracts-smoke.sh. No external delivery claim.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
exec node "$root/.github/workflows/scripts/smoke/helpers/media-contracts.mjs" pg api
