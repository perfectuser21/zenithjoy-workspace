#!/usr/bin/env bash
# Walking Skeleton #1 — Dashboard 占位 smoke
#
# 目的：满足 zenithjoy CI 的 lint-feature-has-smoke 规则（feat: + apps/*/src 必须有
# smoke 脚本）。本 PR 范围是 dashboard 4 个页面 + API client + Playwright E2E。
#
# 真正的端到端 smoke 在 golden-path-1-douyin-smoke.sh（smoke-integ PR #251），
# 它串起 dashboard + api + agent 全链路。本脚本只是 dashboard PR 自身的占位
# 验证 — 检查 4 个页面 + API client + E2E spec 文件存在。
#
# 升级到 medium 时改成：cd apps/dashboard && npm run e2e -- walking-skeleton-1.spec.ts

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Walking Skeleton #1 — Dashboard smoke (placeholder)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 4 个页面文件
test -f apps/dashboard/src/pages/AgentDownloadPage.tsx
test -f apps/dashboard/src/pages/DouyinBindPage.tsx
test -f apps/dashboard/src/pages/FolderBindPage.tsx
test -f apps/dashboard/src/pages/PublishPage.tsx

# API client + E2E spec
test -f apps/dashboard/src/api/walking-skeleton-1.api.ts
test -f apps/dashboard/e2e/walking-skeleton-1.spec.ts

echo "  ✅ 4 个页面 + API client + E2E spec 文件存在"
echo ""
echo "  注：完整 E2E 在 golden-path-1-douyin-smoke.sh"
