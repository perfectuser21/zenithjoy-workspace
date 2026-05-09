#!/usr/bin/env bash
# Sprint 2.1e — install pack endpoint + build script real verify
set -euo pipefail

AGENT_DIR="${AGENT_DIR:-services/agent}"

echo "[smoke] step 1: build script + install-pack files exist"
test -x "$AGENT_DIR/scripts/build-install-pack.sh" || { echo "FAIL build script"; exit 1; }
test -f "$AGENT_DIR/install-pack/start.bat" || { echo "FAIL start.bat"; exit 1; }
test -f "$AGENT_DIR/install-pack/.env.template" || { echo "FAIL .env.template"; exit 1; }
test -f "apps/api/src/routes/agent-install-pack.ts" || { echo "FAIL endpoint"; exit 1; }
test -f "apps/api/src/services/install-pack-manifest.ts" || { echo "FAIL service"; exit 1; }

echo "[smoke] step 2: .env.template 含 3 必需 key"
for k in ZENITHJOY_API_BASE ZENITHJOY_LICENSE ZENITHJOY_CHROME_DEBUG_PORT; do
  grep -q "^${k}=" "$AGENT_DIR/install-pack/.env.template" || { echo "FAIL: $k missing"; exit 1; }
done

echo "[smoke] step 3: vitest install-pack-manifest unit"
(cd apps/api && npx vitest run src/services/__tests__/install-pack-manifest.test.ts 2>&1 | tail -3) || exit 1

echo "[smoke] step 4: vitest agent-install-pack endpoint"
(cd apps/api && npx vitest run src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -3) || exit 1

echo "[smoke] OK"
