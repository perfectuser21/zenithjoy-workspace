#!/usr/bin/env bash
# Path 4 Sprint 1 ws3 — DeepSeek 私聊草稿 + listen_chat + 安全边界 smoke
#
# 静态校验：
#   1) wechat-draft.ts generateChatDraft + 调 openrouter
#   2) listen_chat.py pywinauto 配方（_parse_item_name/chat_input_field，禁 wxauto4）
#   3) routes/wechat.ts /draft-generate 端点
#   4) 安全边界（auto-agent gating 模型；已取代旧 A 路线"一律人审"护栏）
#   5) listen_chat.py def 黑名单（不许主动发起）
#
# ⚠️ Step 4 演进说明（Sprint 06220821，2026-06-22）：
#   旧 A 路线护栏「AI 一律不自动发、禁 approval_source='system'/'auto'」已被
#   **auto-agent gating 模型**取代（用户 2026-06-22 决策 + 登记表「工作开关与时段」：
#   开启自动代理 = 纯 AI 自动回）。approval_source='system'（系统无人审自动发）现在是
#   合法设计。新安全边界 = 「ON + 名单内 + 营业时间内 才自动发，其余一律不发」，
#   由 decideReplyRoute 真值表 + getAutoAgentConfig 在 wechat-draft.ts 强制。
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

echo "=== ws3 Step 4: 安全边界 — auto-agent gating（ON+名单内+营业时间才自动发，其余不发）==="
# 演进：A 路线"一律人审"护栏已被 auto-agent gating 取代（见文件头 ⚠️ 说明）。
# approval_source='system' 现在合法（系统无人审自动发）→ 不再禁。改验新安全边界三条：

# ① auto 模式白名单仍生效：wechat-draft.ts 不再无条件跳过名单（旧 bug 形态复发即红），
#    且按 decideReplyRoute 把名单外 → not_in_whitelist 不发。
if grep -Eq "if \(mode !== 'auto'\) \{" "$DRAFT"; then
  echo "FAIL: auto 分支又整段跳白名单 search（C1 安全边界被破）"; exit 1
fi
grep -q "decideReplyRoute" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未按 decideReplyRoute 真值表分流"; exit 1; }
grep -q "not_in_whitelist" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未对名单外返回 not_in_whitelist"; exit 1; }

# ② 自动代理总开关 + 营业时间 gating：必须读 getAutoAgentConfig（OFF=监控态不返回 reply）。
grep -q "getAutoAgentConfig" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未读 getAutoAgentConfig（总开关/营业时间 gating 缺失）"; exit 1; }
grep -q "withinBusinessHours" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未做营业时间判定"; exit 1; }

# ③ 关键人出站任务只在 gated 路径产生：cs-outbound service 存在且播报由开关跳变触发。
OUTBOUND=apps/api/src/services/wechat/cs-outbound.ts
test -f "$OUTBOUND" || { echo "FAIL: cs-outbound.ts 缺（关键人出站任务无来源）"; exit 1; }
grep -q "enqueueKeyContactBroadcast" "$OUTBOUND" \
  || { echo "FAIL: cs-outbound.ts 缺 enqueueKeyContactBroadcast（开关跳变播报）"; exit 1; }

# 监控态仍出草稿入审核台：pending_review 状态保留（OFF 时出草稿不发）。
grep -qE "pending_review" "$DRAFT" \
  || { echo "FAIL: wechat-draft.ts 未写 pending_review 状态（监控态草稿）"; exit 1; }
echo "  PASS auto-agent gating（白名单生效 + 总开关/营业时间 gating + 关键人出站 gated）"

echo "=== ws3 Step 5: listen_chat.py def 黑名单 ==="
set +o pipefail
FOUND=$(grep -rE "^[[:space:]]*def[[:space:]]+(send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" "$RPA_DIR/" 2>/dev/null | wc -l | tr -d ' ')
set -o pipefail
[ "$FOUND" = "0" ] || { echo "FAIL: 找到 $FOUND 个主动发起 def"; exit 1; }
echo "  PASS 主动发起 def 0 命中"

echo ""
echo "ws3-smoke: ALL PASS"
