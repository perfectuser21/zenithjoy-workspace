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
