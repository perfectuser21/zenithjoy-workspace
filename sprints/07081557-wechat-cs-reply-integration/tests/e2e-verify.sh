#!/usr/bin/env bash
# Current shared reply/escalation contract; explicit disposable PostgreSQL required.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT/apps/api"
npx vitest run tests/services/wechat-draft.test.ts
exec npx vitest run --config vitest.business-pg.config.ts
