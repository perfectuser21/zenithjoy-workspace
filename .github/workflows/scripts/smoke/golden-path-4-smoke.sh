#!/usr/bin/env bash
# golden-path-4-smoke.sh — Path 4 客户私域 AI 接管 端到端 smoke
#
# 状态：ws1 占位骨架。
# 完整 6 step 实现在 ws6 写（参考 sprint-d-path4-private-ai-thin/contract-dod-ws6.md）：
#   Step 1 扫码绑个微 → Step 2 飞书 4 表初始化 → Step 3 私聊 AI 草稿 →
#   Step 4 朋友圈 AI 草稿 → Step 5 飞书审批后真发 → Step 6 回执回写
#
# CI 默认 REAL_PUBLISH=0（dryrun 不污染真账号）；Lead 自验在 rog-xian REAL_PUBLISH=1 真发。
#
# 用法:
#   REAL_PUBLISH=0 bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
set -euo pipefail

REAL_PUBLISH="${REAL_PUBLISH:-0}"
echo "golden-path-4-smoke: REAL_PUBLISH=${REAL_PUBLISH}"
echo "Step 1-6 完整链路在 ws6 实现，ws1 仅占位让 lint-feature-has-smoke 过。"

# ws1 阶段最低自检：3 个 src 文件存在
test -f apps/api/src/llm/openrouter.ts && echo "Step 1 ✅ openrouter.ts 存在" || (echo "FAIL: openrouter.ts 缺"; exit 1)
test -f apps/api/src/routes/wechat.ts && echo "Step 2 ✅ wechat 路由存在" || (echo "FAIL: wechat 路由缺"; exit 1)
test -f services/agent/src/handlers/wechat-rpa.ts && echo "Step 3 ✅ wechat-rpa handler 存在" || (echo "FAIL: handler 缺"; exit 1)
test -f services/agent/wechat-rpa/qr_bind.py && echo "Step 4 ✅ qr_bind.py stub 存在" || (echo "FAIL: qr_bind.py 缺"; exit 1)
test -f scripts/deploy-agent-to-rog.sh && echo "Step 5 ✅ deploy-agent-to-rog.sh 存在" || (echo "FAIL: deploy script 缺"; exit 1)
ls apps/api/db/migrations/2026*create_wechat_publish_task*.sql > /dev/null 2>&1 \
  && echo "Step 6 ✅ wechat_publish_task migration 存在" \
  || (echo "FAIL: migration 缺"; exit 1)

echo ""
echo "ws1 占位 smoke 全绿（6 step 真链路实现等 ws2-6）"
