#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
test -s .github/workflows/scripts/__tests__/gp-anchor-fixture.test.mjs
node --test scripts/product-map/__tests__/product-map.test.js .github/workflows/scripts/__tests__/gp-anchor-fixture.test.mjs
