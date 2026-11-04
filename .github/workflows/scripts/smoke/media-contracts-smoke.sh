#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/media-contracts.mjs"
test -s "$runner"
exec node "$runner" "$@"
