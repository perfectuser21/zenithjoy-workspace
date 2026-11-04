#!/usr/bin/env bash
# Local prototype only: missing-key contract, no external voice/model operation.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/media-extra-node-contracts.mjs"
test -f "$runner"
exec node "$runner" prototype
