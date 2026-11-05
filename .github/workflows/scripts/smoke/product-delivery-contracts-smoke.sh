#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
# Test the real child-process rejection behavior before the retained PDD contracts.
exec node .github/workflows/scripts/smoke/helpers/executed-node-contracts.mjs \
  .github/workflows/scripts/smoke/helpers/executed-contracts.test.mjs \
  .github/workflows/scripts/smoke/helpers/pipeline-smoke.test.mjs \
  .github/workflows/scripts/smoke/helpers/media-contracts.test.mjs \
  services/listing-workflow/__tests__/*.test.mjs \
  scripts/release-gate/__tests__/two-column-fixtures.test.mjs
