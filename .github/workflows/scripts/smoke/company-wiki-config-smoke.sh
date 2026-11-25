#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
node --test "$ROOT/services/phone-adb-controller/__tests__/company-config.test.mjs"
node --test "$ROOT/apps/api/scripts/company-wiki-import.test.mjs" "$ROOT/apps/api/scripts/company-projection-adapters.test.mjs" "$ROOT/services/phone-adb-controller/__tests__/company-config-sync.test.mjs"
cd "$ROOT"
# 真实渲染公司页面，覆盖深色父背景下的文字/标签/来源及读取状态。
# JSDom只mock API数据，真实组件以computed前景和逐祖先RGBA背景计算对比度。
npm test \
  --workspace @zenithjoy/dashboard \
  -- \
  --run src/pages/CompanyProfilePage.config.test.tsx
# Real API and phone frozen-company SQL contracts share the fresh disposable PG
# lifecycle in ci-l4-integration.yml / api-integration-test:
#   npx vitest run --config vitest.pg-contracts.config.ts
# The required Integration selector includes their phone company-config consumers.
# No duplicate default-Vitest invocation or separate scratch-db bootstrap here.

# Paired deployment's real capture/install/readiness/receipt contracts remain in
# required L3 openclaw-scripts-test: services/phone-adb-controller/__tests__/*.test.mjs
# The complete paired-deploy-smoke.test.mjs suite runs there once, rather than
# duplicating its 22 cases in this separate 90-second company configuration smoke.

# 离线验证来源受租户约束及 Notion、飞书记录字段转换。
npm test \
  --workspace @zenithjoy/api \
  -- \
  src/routes/company-source-sync.test.ts src/services/company-source-import.test.ts \
  src/services/company-source-sync.test.ts src/services/notion-company-source-worker.test.ts

# 自动同步由开户服务登记现有 Notion 三表，拒绝匿名变更租户的开关。
npm test \
  --workspace @zenithjoy/api \
  -- \
  src/routes/customer-workspaces.test.ts

# 轻量获客的业务库可独立同步，只核对工作台归属。
npm test \
  --workspace @zenithjoy/api \
  -- \
  src/services/company-source-sync.test.ts -t '独立同步只核对工作台归属'
