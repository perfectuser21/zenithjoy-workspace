#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root"

test -f apps/api/src/routes/aidge.test.ts
test -f apps/api/src/middleware/aidge-viewer.test.ts
test -f apps/dashboard/src/pages/__tests__/AidgeWorkspacePage.test.tsx
test -f apps/dashboard/src/api/aidge-access.test.ts
npm test --workspace=apps/api -- src/routes/aidge.test.ts src/middleware/aidge-viewer.test.ts src/services/aidge-catalog.test.ts src/services/aidge-gateway.test.ts src/services/aidge-translation.test.ts
npm test --workspace=apps/dashboard -- src/pages/__tests__/AidgeWorkspacePage.test.tsx
npm test --workspace=apps/dashboard -- src/api/aidge-access.test.ts src/config/__tests__/navigation.config.test.ts
npm run typecheck --workspace=apps/api
npm run typecheck --workspace=apps/dashboard
