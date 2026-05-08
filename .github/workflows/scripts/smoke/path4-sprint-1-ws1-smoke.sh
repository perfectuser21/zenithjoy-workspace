#!/usr/bin/env bash
# Path 4 Sprint 1 ws1 — DB schema + 中台路由 + Agent 协议 + LLM audit + rog 部署脚本 smoke
#
# 静态校验：
#   1) wechat_publish_task migration 在位 + approval_source CHECK 约束
#   2) llm_audit migration 在位 + provider/model/cost 字段
#   3) /api/wechat 路由 3 个端点：qr-bind / draft-review-poll / scheduler-tick
#   4) services/agent/src/handlers/wechat-rpa.ts spawn Python 子进程
#   5) apps/api/src/llm/openrouter.ts FORCE_5XX + CI max_tokens=20
#   6) scripts/deploy-agent-to-rog.sh 部署脚本
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=== ws1 Step 1: DB migration 双表 ==="
ls apps/api/db/migrations/2026*create_wechat_publish_task*.sql >/dev/null 2>&1 \
  || { echo "FAIL: wechat_publish_task migration 缺"; exit 1; }
grep -qE "approval_source.*CHECK|CHECK.*approval_source|feishu_user.*feishu_api" apps/api/db/migrations/2026*create_wechat_publish_task*.sql \
  || { echo "FAIL: migration 缺 approval_source CHECK 约束"; exit 1; }
echo "  PASS wechat_publish_task migration + approval_source CHECK"

ls apps/api/db/migrations/2026*create_llm_audit*.sql >/dev/null 2>&1 \
  || { echo "FAIL: llm_audit migration 缺"; exit 1; }
grep -qE "provider|model|cost" apps/api/db/migrations/2026*create_llm_audit*.sql \
  || { echo "FAIL: llm_audit migration 缺核心字段"; exit 1; }
echo "  PASS llm_audit migration"

echo "=== ws1 Step 2: /api/wechat 3 端点 ==="
ROUTE=apps/api/src/routes/wechat.ts
test -f "$ROUTE" || { echo "FAIL: wechat.ts 缺"; exit 1; }
grep -q "/qr-bind" "$ROUTE" || { echo "FAIL: 缺 /qr-bind"; exit 1; }
grep -q "/draft-review-poll" "$ROUTE" || { echo "FAIL: 缺 /draft-review-poll"; exit 1; }
grep -q "/scheduler-tick" "$ROUTE" || { echo "FAIL: 缺 /scheduler-tick"; exit 1; }
echo "  PASS 3 端点齐"

echo "=== ws1 Step 3: wechat-rpa.ts spawn ==="
HANDLER=services/agent/src/handlers/wechat-rpa.ts
test -f "$HANDLER" || { echo "FAIL: wechat-rpa.ts 缺"; exit 1; }
grep -qE "spawn|child_process|execFile" "$HANDLER" \
  || { echo "FAIL: wechat-rpa.ts 未 spawn 子进程"; exit 1; }
echo "  PASS handler spawn"

echo "=== ws1 Step 4: openrouter.ts FORCE_5XX + CI max_tokens=20 ==="
LLM=apps/api/src/llm/openrouter.ts
test -f "$LLM" || { echo "FAIL: openrouter.ts 缺"; exit 1; }
grep -q "OPENROUTER_FORCE_5XX" "$LLM" \
  || { echo "FAIL: openrouter.ts 缺 OPENROUTER_FORCE_5XX 故障注入"; exit 1; }
grep -qE "max_tokens.*20|20.*max_tokens" "$LLM" \
  || { echo "FAIL: openrouter.ts 缺 CI max_tokens=20 cap"; exit 1; }
echo "  PASS LLM 封装 + 故障注入 + CI cap"

echo "=== ws1 Step 5: deploy-agent-to-rog.sh ==="
DEPLOY=scripts/deploy-agent-to-rog.sh
test -f "$DEPLOY" || { echo "FAIL: deploy-agent-to-rog.sh 缺"; exit 1; }
echo "  PASS deploy 脚本在位"

echo ""
echo "ws1-smoke: ALL PASS (静态契约 6 项)"
