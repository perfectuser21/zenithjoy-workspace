#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root"

test -f apps/api/src/routes/aidge.test.ts
test -f apps/dashboard/src/pages/__tests__/AidgeWorkspacePage.test.tsx
npm test --workspace=apps/api -- src/routes/aidge.test.ts
npm test --workspace=apps/dashboard -- src/pages/__tests__/AidgeWorkspacePage.test.tsx
