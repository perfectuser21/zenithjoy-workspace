#!/usr/bin/env bash
# realtime-voice-mvp-domestic-smoke.sh
# 国内厂商组合语音管线（豆包 Realtime Dialogue 服务端中继）冒烟测试
#
# 自包含：自己起服务、自己测、自己关。不依赖真实 VOLC_APP_ID/VOLC_ACCESS_KEY
# （CI 无此密钥）——协议编解码正确性已由 doubao-protocol.test.js 的单元测试
# （含真实抓包字节回归用例）覆盖；这里只验证服务器路由/WebSocket 握手/
# 缺凭据时的错误处理是确定性行为。真实链路已在开发阶段用真实凭据手动验证过
# （连接/会话建立/文字对话/流式回复/TTS音频全链路测通）。
#
# 验证：
#   1. 单元测试全过（doubao-protocol.js 编解码逻辑）
#   2. 服务能正常启动
#   3. GET  /domestic.html  返回 200
#   4. WS   /ws/domestic    握手成功，start 后缺凭据时返回 error 消息（不崩溃）
#
# 退出码：
#   0  全过
#   1  单元测试失败
#   2  服务未能在超时内启动
#   3  GET /domestic.html 不符合预期
#   4  WebSocket 握手或错误处理不符合预期

set -uo pipefail

APP_DIR="apps/realtime-voice-mvp"
PORT=8097
BASE="http://localhost:${PORT}"
LOG_FILE=$(mktemp)
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  realtime-voice-mvp-domestic smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/4] 单元测试：doubao-protocol.js"
npm install --no-audit --no-fund --silent 2>&1 | tail -5
(cd "$APP_DIR" && npx vitest run) || {
  echo "  FAIL: 单元测试失败"
  exit 1
}
echo "  PASS"

echo "▶ 启动服务 (PORT=${PORT}, 无 VOLC_APP_ID/VOLC_ACCESS_KEY)"
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
  exit 2
fi
echo "  服务已就绪"

echo "▶ [2/4] GET /domestic.html"
BODY=$(curl -fsS "${BASE}/domestic.html") || { echo "  FAIL: 请求失败"; exit 3; }
if ! echo "$BODY" | grep -q "豆包语音验证"; then
  echo "  FAIL: 页面内容不含预期标题"
  exit 3
fi
echo "  PASS"

echo "▶ [3/4] WebSocket /ws/domestic 握手 + start 事件（无凭据时应报错不崩溃）"
node -e "
const ws = new WebSocket('ws://localhost:${PORT}/ws/domestic');
const timer = setTimeout(() => { console.log('FAIL: 超时未收到 error 消息'); process.exit(1); }, 8000);
ws.addEventListener('open', () => ws.send(JSON.stringify({type:'start'})));
ws.addEventListener('message', (e) => {
  if (typeof e.data !== 'string') return;
  const msg = JSON.parse(e.data);
  if (msg.type === 'error' && /VOLC_APP_ID/.test(msg.message)) {
    console.log('PASS: 收到预期的凭据缺失错误');
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
ws.addEventListener('error', () => { console.log('FAIL: WebSocket 连接错误'); process.exit(1); });
" || { echo "  FAIL: WebSocket 交互不符合预期"; cat "$LOG_FILE"; exit 4; }
echo "  PASS"

echo "▶ [4/4] 服务进程未崩溃"
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "  FAIL: 服务进程已退出（可能崩溃）"
  cat "$LOG_FILE"
  exit 4
fi
echo "  PASS"

echo "✅ realtime-voice-mvp-domestic-smoke 全过"
exit 0
