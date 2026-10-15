#!/usr/bin/env bash
# CRM异步回填合同回归；真实手机送达另以实屏及receipt验收。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
python3 -m unittest discover -s services/wechat-cs-android/tests
cd apps/api
npx --no-install vitest run \
  src/services/wechat/__tests__/crm-analysis.test.ts \
  src/routes/__tests__/crm-analysis-rebuild.test.ts \
  src/routes/__tests__/wechat-crm-event-access.test.ts \
  src/routes/__tests__/wechat-message-receipt.test.ts \
  src/llm/__tests__/openrouter-timeout.test.ts

# 单好友partial与原full扫描同行回归，不能把增量上报当全量快照。
npx --no-install vitest run \
  src/routes/__tests__/crm-partial-friend-ingest.test.ts \
  tests/routes/crm-friend-scan-reconcile.test.ts \
  tests/routes/crm-friend-scan-trigger.test.ts \
  tests/routes/crm-table-identity.test.ts
