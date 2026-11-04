#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
test -s scripts/release-gate/__tests__/two-column-fixtures.test.mjs
node --test services/listing-workflow/__tests__/*.test.mjs scripts/release-gate/__tests__/two-column-fixtures.test.mjs
