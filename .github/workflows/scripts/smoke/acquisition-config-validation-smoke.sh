#!/usr/bin/env bash
# line02/keyword_acquisition#step7 — acquisition config merged-bound regression.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
cd "$REPO_ROOT/apps/api"

npx vitest run tests/routes/acquisition-dispatch.test.ts \
  -t 'partial patch cannot make merged keyword bounds invalid' \
  --reporter=verbose
npx vitest run tests/routes/acquisition-dispatch.test.ts --reporter=verbose
