#!/usr/bin/env bash
# Path 4 Sprint 1 ws3 — DeepSeek 私聊草稿 + listen_chat + A 路线护栏 smoke
#
# 静态校验：
#   1) wechat-draft.ts generateChatDraft + 调 openrouter
#   2) listen_chat.py pywinauto 配方（_parse_item_name/chat_input_field，禁 wxauto4）
#   3) routes/wechat.ts /draft-generate 端点
#   4) A 路线护栏：approval_status='pending_review' + approval_source NULL（不允许 system/auto）
#   5) listen_chat.py def 黑名单（不许主动发起）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=== ws3 Step 1: wechat-draft.ts generateChatDraft ==="
DRAFT=apps/api/src/services/wechat-draft.ts
test -f "$DRAFT" || { echo "FAIL: wechat-draft.ts 缺"; exit 1; }
grep -qE "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+generateChatDraft|export[[:space:]]+\{[^}]*generateChatDraft" "$DRAFT" \
  || { echo "FAIL: 缺 generateChatDraft export"; exit 1; }
grep -qE "openrouter|callDeepSeek|chatCompletion" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未调 openrouter/DeepSeek"; exit 1; }
node -e "const s=require('fs').readFileSync('$DRAFT','utf8'); if(!s.includes('generateChatDraft')) process.exit(1);" \
  || { echo "FAIL: node 读取 wechat-draft.ts 校验失败"; exit 1; }
echo "  PASS generateChatDraft + openrouter 调用"

echo "=== ws3 Step 2: listen_chat.py pywinauto 配方（微信4.0 迁移，禁 wxauto4）==="
RPA_DIR=services/agent/wechat-rpa
test -f "$RPA_DIR/listen_chat.py" || { echo "FAIL: listen_chat.py 缺"; exit 1; }
grep -qE "import[[:space:]]+pywinauto|from[[:space:]]+pywinauto" "$RPA_DIR/listen_chat.py" \
  || { echo "FAIL: listen_chat.py 未 import pywinauto"; exit 1; }
grep -qE "_parse_item_name|chat_input_field" "$RPA_DIR/listen_chat.py" \
  || { echo "FAIL: listen_chat.py 缺 pywinauto 配方关键字"; exit 1; }
! grep -qE "import[[:space:]]+wxauto|from[[:space:]]+wxauto" "$RPA_DIR/listen_chat.py" \
  || { echo "FAIL: listen_chat.py 仍残留 wxauto import"; exit 1; }
echo "  PASS listen_chat.py 含 pywinauto 配方，无 wxauto4"

echo "=== ws3 Step 3: /api/wechat/draft-generate 端点 ==="
ROUTE=apps/api/src/routes/wechat.ts
grep -q "/draft-generate" "$ROUTE" \
  || { echo "FAIL: 缺 /draft-generate 路由"; exit 1; }
grep -qE "generateChatDraft|wechat-draft" "$ROUTE" \
  || { echo "FAIL: routes/wechat.ts 未调 generateChatDraft"; exit 1; }
echo "  PASS /draft-generate 路由 + service 调用"

echo "=== ws3 Step 4: A 路线护栏 — approval_source 禁 system/auto ==="
if grep -rE "approval_source[[:space:]]*[:=][[:space:]]*['\"]system['\"]|approval_source[[:space:]]*[:=][[:space:]]*['\"]auto['\"]" apps/api/src 2>/dev/null; then
  echo "FAIL: 出现禁用 approval_source='system'/'auto'（A 路线人审护栏被破）"
  exit 1
fi
grep -qE "pending_review" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未写 pending_review 状态"; exit 1; }
echo "  PASS A 路线护栏（无 system/auto，初始 pending_review）"

echo "=== ws3 Step 5: listen_chat.py def 黑名单 ==="
set +o pipefail
FOUND=$(grep -rE "^[[:space:]]*def[[:space:]]+(send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" "$RPA_DIR/" 2>/dev/null | wc -l | tr -d ' ')
set -o pipefail
[ "$FOUND" = "0" ] || { echo "FAIL: 找到 $FOUND 个主动发起 def"; exit 1; }
echo "  PASS 主动发起 def 0 命中"

echo ""
echo "ws3-smoke: ALL PASS"
