#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

bash .github/workflows/scripts/smoke/acquisition-config-validation-smoke.sh

cd apps/api

npx vitest run tests/routes/acquisition-dispatch.test.ts \
  -t 'partial patch cannot make merged keyword bounds invalid' \
  --reporter=verbose

npx vitest run tests/routes/acquisition-dispatch.test.ts --reporter=verbose
