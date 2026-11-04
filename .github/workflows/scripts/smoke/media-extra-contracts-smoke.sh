#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
node "$root/.github/workflows/scripts/smoke/helpers/media-extra-contracts.mjs"
node "$root/.github/workflows/scripts/smoke/helpers/media-extra-node-contracts.mjs" bridge
node "$root/.github/workflows/scripts/smoke/helpers/media-extra-node-contracts.mjs" prototype
