#!/usr/bin/env bash
# realtime-voice-mvp-smoke.sh
# OpenAI Realtime H5 语音验证 MVP 的冒烟测试
#
# 自包含：自己起服务、自己测、自己关，不依赖其它 job 已启动的服务。
# 不依赖真实 OPENAI_API_KEY（CI 无此密钥）——只验证服务器路由/静态托管/
# 缺 Key 时的错误处理是确定性行为，真实 OpenAI 调用链路已在开发阶段手动验证过。
#
# 验证：
#   1. 服务能正常启动
#   2. GET  /          返回 200，页面包含预期标题
#   3. POST /session   缺 OPENAI_API_KEY 时返回 500 + 明确错误信息（不崩溃、不裸露堆栈）
#   4. 前端不得用绝对根路径 fetch('/session')（regression：部署在 /realtime-mvp/ 子路径
#      下时，绝对路径会跳出前缀打到 https://host/session，落进反代默认兜底站点被拒
#      405——2026-07-17 真机测试实锤过一次，必须用相对路径 fetch('session')）
#
# 退出码：
#   0  全过
#   1  服务未能在超时内启动
#   2  GET / 不符合预期
#   3  POST /session 错误处理不符合预期
#   4  前端 fetch 用了绝对根路径（子路径部署会跳出前缀）

set -uo pipefail

APP_DIR="apps/realtime-voice-mvp"
PORT=8093
BASE="http://localhost:${PORT}"
LOG_FILE=$(mktemp)
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  realtime-voice-mvp smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ 启动服务 (PORT=${PORT}, 无 OPENAI_API_KEY)"
(cd "$APP_DIR" && PORT="$PORT" node server.js > "$LOG_FILE" 2>&1) &
SERVER_PID=$!

READY=0
for i in $(seq 1 20); do
  if curl -fs "${BASE}/" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "  FAIL: 服务未能在 10s 内启动"
  cat "$LOG_FILE"
  exit 1
fi
echo "  服务已就绪"

echo "▶ [1/2] GET /"
BODY=$(curl -fsS "${BASE}/") || { echo "  FAIL: GET / 请求失败"; exit 2; }
if ! echo "$BODY" | grep -q "OpenAI Realtime"; then
  echo "  FAIL: 页面内容不含预期标题"
  exit 2
fi
echo "  PASS"

echo "▶ [2/2] POST /session（无 OPENAI_API_KEY）"
HTTP_CODE=$(curl -sS -o /tmp/rtm-session-resp.json -w "%{http_code}" -X POST "${BASE}/session")
if [ "$HTTP_CODE" != "500" ]; then
  echo "  FAIL: 期望 500，实际 ${HTTP_CODE}"
  cat /tmp/rtm-session-resp.json
  exit 3
fi
if ! grep -q "OPENAI_API_KEY" /tmp/rtm-session-resp.json; then
  echo "  FAIL: 错误信息未指明缺少 OPENAI_API_KEY"
  cat /tmp/rtm-session-resp.json
  exit 3
fi
echo "  PASS"

echo "▶ [3/3] 前端 fetch 路径必须是相对路径（子路径部署兼容性）"
if grep -qE "fetch\(['\"]\/session" "$APP_DIR/public/index.html"; then
  echo "  FAIL: index.html 用了绝对根路径 fetch('/session')，子路径部署（如 /realtime-mvp/）下会 404/405"
  exit 4
fi
echo "  PASS"

echo "✅ realtime-voice-mvp-smoke 全过"
exit 0
