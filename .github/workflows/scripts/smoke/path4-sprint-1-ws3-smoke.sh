#!/usr/bin/env bash
# Path 4 Sprint 1 ws3 — DeepSeek 私聊草稿 + listen_chat + 安全边界 smoke
#
# 静态校验：
#   1) wechat-draft.ts generateChatDraft + 调 openrouter
#   2) listen_chat.py pywinauto 配方（_parse_item_name/chat_input_field，禁 wxauto4）
#   3) routes/wechat.ts /draft-generate 端点
#   4) 安全边界（去飞书 + 自动直发 gating 模型）
#   5) listen_chat.py def 黑名单（不许主动发起）
#
# ⚠️ Step 4 演进说明（去飞书第一刀，2026-06-30）：
#   旧 A 路线（飞书审核台 + whitelist 真值表 + 营业时间）已被**去飞书 + 自动直发**取代：
#   个人未标黑 → 直接返回 reply（自动直发，agent 立即 UIA 发）；群 / CRM 标黑 → 不回；
#   AI 失败 → 中台 console.error 报红、不返回占位。白名单/黑名单只查本地，不再查飞书。
#   新安全边界由 decideAutoSendRoute（群/黑名单 gating）+ isContactBlacklisted（本地黑名单）强制。
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

echo "=== ws3 Step 4: 安全边界 — 去飞书 + 自动直发 gating（群/标黑不回，AI 失败报红）==="
# 去飞书第一刀（2026-06-30，见文件头 ⚠️ 说明）：验证新安全边界四条。

# ① gating 走 decideAutoSendRoute（群/黑名单），不再有 whitelist 真值表 decideReplyRoute。
grep -q "decideAutoSendRoute" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未按 decideAutoSendRoute 做群/黑名单 gating"; exit 1; }
if grep -q "decideReplyRoute" "$DRAFT"; then
  echo "FAIL: chat 路径仍残留旧 whitelist 真值表 decideReplyRoute（应去飞书后移除）"; exit 1
fi

# ② 群消息 gating：必须读 is_group 标志（群不回）。
grep -q "is_group" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未处理 is_group（群消息 gating 缺失）"; exit 1; }

# ③ 黑名单只查本地：必须有 isContactBlacklisted 本地查询，且不再查飞书"客户档案"。
grep -q "isContactBlacklisted" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未做本地黑名单查询 isContactBlacklisted"; exit 1; }
if grep -qE "getCustomerTableId|getInteractionTableId" "$DRAFT"; then
  echo "FAIL: chat 路径仍残留飞书客户档案/互动记录查询（应彻底去飞书）"; exit 1
fi

# ④ AI 生成失败立即报红：必须有 console.error ALARM（不静默、不发占位）。
grep -q "ALARM" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts AI 失败未报红（缺 console.error ALARM）"; exit 1; }
echo "  PASS 去飞书 + 自动直发 gating（群/标黑不回 + 本地黑名单 + AI 失败报红）"

echo "=== ws3 Step 5: listen_chat.py def 黑名单 ==="
set +o pipefail
FOUND=$(grep -rE "^[[:space:]]*def[[:space:]]+(send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" "$RPA_DIR/" 2>/dev/null | wc -l | tr -d ' ')
set -o pipefail
[ "$FOUND" = "0" ] || { echo "FAIL: 找到 $FOUND 个主动发起 def"; exit 1; }
echo "  PASS 主动发起 def 0 命中"

echo ""
echo "ws3-smoke: ALL PASS"
