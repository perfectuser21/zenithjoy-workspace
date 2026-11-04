#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
exec node "$root/.github/workflows/scripts/smoke/helpers/media-contracts.mjs" "$@"
