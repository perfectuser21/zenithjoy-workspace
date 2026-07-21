#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Staff Hub verify =="
node "$ROOT/scripts/check-staff-hub-llm-imports.mjs"

echo "== API contract =="
cd "$ROOT/apps/api"
npx vitest run src/routes/__tests__/staff.test.ts

echo "== Staff Hub build =="
cd "$ROOT/apps/staff-hub"
npm run build

echo "staff-hub verify: PASS"
