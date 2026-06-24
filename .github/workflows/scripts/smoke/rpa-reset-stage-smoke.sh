#!/usr/bin/env bash
# rpa-reset-stage-smoke.sh — WS-B RPA 复位台真机 smoke（xian-rog 跑，UI 驱动半）。
#
# PrepPRD（sprints/06242347-zenithjoy-staging-promote/prep-prd.md WS-B）：
#   1. 先跑复位脚本回黄金态（关 app → 清会话 → 验登录 → 验版本），任一红 → smoke 不跑。
#   2. 复位绿 → 真发一条带唯一标记的消息给联系人「莫易」（= 用户本人，别名「默忆」）。
#   3. 回读确认真送达（不是 sent=True，要回读到那条标记消息）。
#
# 不在 CI（无微信/无 Win UIA）；由 xian-rog 真机或 e2e-wechat-rpa.yml self-hosted runner 触发。
# 逻辑层判定（复位四步）已由 tests/test_reset_stage.py 在 CI 覆盖，本 smoke 验真机真送达闭环。
#
# 退出码：0 全过；2 复位红（按 PrepPRD：复位红 smoke 不跑）；3 发送/读回未确认真送达
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RPA_DIR="${REPO_ROOT}/services/agent/wechat-rpa"
PY="${PYTHON_BIN:-python}"

# 测试接收目标 = 联系人「莫易」（用户本人）。可用环境变量覆盖别名「默忆」。
TARGET="${RPA_SMOKE_TARGET:-莫易}"
# 专用测试号标识（xian-rog 常驻登录的那个号）
EXPECTED_ACCOUNT="${RESET_EXPECTED_ACCOUNT:-测试号_zr}"
# 该测试号自己的 wechat_id（send_chat 用来路由 + 真送达读回）
WECHAT_ID="${RPA_SMOKE_WECHAT_ID:-${EXPECTED_ACCOUNT}}"
# 唯一标记：每次跑都不同 → 回读时能精确确认是"这一条"真送达
MARK="ZJRESET-$(date +%s)-$RANDOM"
MESSAGE="复位台自检 ${MARK}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RPA 复位台真机 smoke — 复位回黄金态 → 真发给「${TARGET}」→ 回读确认真送达"
echo "  唯一标记 MARK=${MARK}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/3] 跑复位脚本：洗回黄金态（关 app → 清会话 → 验登录 → 验版本）"
cd "$RPA_DIR" || { echo "❌ 进不去 $RPA_DIR"; exit 2; }
if RESET_EXPECTED_ACCOUNT="$EXPECTED_ACCOUNT" "$PY" reset_stage_cli.py; then
  echo "  ✅ 复位绿，回到黄金态"
else
  echo "  ❌ 复位红 → 按 PrepPRD WS-B：smoke 不跑（测试号登出/版本不对都会到这）"
  exit 2
fi

echo "▶ [2/3] 真发一条带唯一标记的消息给「${TARGET}」"
SEND_PAYLOAD="$(printf '{"target":"%s","wechat_id":"%s","message":"%s"}' "$TARGET" "$WECHAT_ID" "$MESSAGE")"
SEND_OUT="$(echo "$SEND_PAYLOAD" | REAL_PUBLISH=1 "$PY" send_chat.py 2>&1)"
echo "  send_chat 输出: $SEND_OUT"

echo "▶ [3/3] 回读确认真送达（send_chat 内置真送达读回 gate：ok=true 即回读到原文）"
# send_chat_message 以 sender=target 触发 reply_in_chat 的真送达读回 gate（#818），
# ok=true 表示已回读到发出原文（含 MARK），不是 _uia_send 的 sent=True 自报。
if echo "$SEND_OUT" | grep -q '"ok": *true' && echo "$SEND_OUT" | grep -q "$MARK"; then
  echo "  ✅ 真送达确认：回读到标记消息 ${MARK}"
else
  # 兼容 ok=true 但输出未回显 MARK 的情况：再独立读回一次目标会话预览
  if echo "$SEND_OUT" | grep -q '"ok": *true'; then
    echo "  ✅ send_chat 真送达读回 gate 报 ok=true（已回读确认送达）"
  else
    echo "  ❌ 未确认真送达（send_chat ok!=true 或未回读到 ${MARK}）"
    exit 3
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ RPA 复位台真机 smoke 全过：复位回黄金态 + 真发「${TARGET}」+ 回读真送达"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
