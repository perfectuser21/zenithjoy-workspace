#!/usr/bin/env bash
# device-command-bridge-smoke.sh — OpenClaw 信号桥·件2 冒烟（中台设备指令桥）
# 1) 关键接线存在（grep 源码级断言，防"实现在但没接上"的假绿）
# 2) 本件全部单测通过（vitest 带 JUnit XML + 退出码双断言）
# 3) 件3（信号桥转发脚本 phonectl.sh/adb-controller-bridge.sh）open_search 接线 + 单测
set -euo pipefail
cd "$(dirname "$0")/../../../.."

API="apps/api"

echo "== [1/2] 源码接线断言 =="
grep -q "'/api/devices'" "$API/src/app.ts" \
  || { echo "FAIL: app.ts 未挂载 /api/devices"; exit 1; }
grep -q "literal('cmd')" "$API/src/schemas/agent-protocol.ts" \
  || { echo "FAIL: ServerMessageSchema 缺 cmd 分支"; exit 1; }
grep -q "literal('cmd_result')" "$API/src/schemas/agent-protocol.ts" \
  || { echo "FAIL: AgentMessageSchema 缺 cmd_result 分支（zod 会直接丢弃上行）"; exit 1; }
grep -q "cmd_result" "$API/src/services/agent-ws.ts" \
  || { echo "FAIL: agent-ws message 链未接 cmd_result"; exit 1; }
grep -q "handleCmdResult" "$API/src/services/agent-ws.ts" \
  || { echo "FAIL: agent-ws 未调 commandBridge.handleCmdResult"; exit 1; }
grep -q "unregister(agentId, ws)" "$API/src/services/agent-ws.ts" \
  || { echo "FAIL: close handler 未把 ws 传给 unregister（快速重连竞态修复丢失）"; exit 1; }
grep -q "prodTokenGuard" "$API/src/routes/devices.ts" \
  || { echo "FAIL: devices 路由缺 production 缺 token 拒服务守卫"; exit 1; }
ls "$API"/db/migrations/*_device_command_bridge.sql >/dev/null 2>&1 \
  || { echo "FAIL: device_command_bridge migration 缺失"; exit 1; }
grep -q "device_command_log" "$API"/db/migrations/*_device_command_bridge.sql \
  || { echo "FAIL: migration 缺 device_command_log 表"; exit 1; }
grep -q "remote_control_config" "$API"/db/migrations/*_device_command_bridge.sql \
  || { echo "FAIL: migration 缺 remote_control_config 表"; exit 1; }
echo "OK: 接线断言全过"

echo "== [2/2] 件2 单测（schema/bridge/registry竞态/agent-ws接线/路由） =="
cd "$API"
RESULTS="/tmp/device-command-bridge-smoke-junit.xml"
rm -f "$RESULTS"
npx vitest run \
  src/schemas/__tests__/agent-protocol-cmd.test.ts \
  src/services/__tests__/command-bridge.test.ts \
  src/services/__tests__/agent-registry-unregister-race.test.ts \
  src/services/__tests__/agent-ws-cmd.test.ts \
  src/routes/__tests__/devices.test.ts \
  --reporter=junit --outputFile="$RESULTS" \
  || { echo "FAIL: 件2 单测退出码非零"; exit 1; }
[ -f "$RESULTS" ] || { echo "FAIL: JUnit XML 未生成（vitest 可能根本没跑）"; exit 1; }
if grep -qE 'failures="[1-9]' "$RESULTS"; then
  echo "FAIL: JUnit XML 存在失败用例"; exit 1
fi
if ! grep -qE 'tests="[1-9]' "$RESULTS"; then
  echo "FAIL: JUnit XML 用例数为 0（测试文件没被收集，假绿）"; exit 1
fi
echo "✅ device-command-bridge smoke 全绿"

cd - >/dev/null

echo "== [3/3] 件3 open_search 接线断言 + bridge 单测 =="
grep -q "'open_search'" "$API/src/routes/devices.ts" \
  || { echo "FAIL: devices.ts ACTION_WHITELIST 缺 open_search"; exit 1; }
grep -q "open_search)" scripts/openclaw/phonectl.sh \
  || { echo "FAIL: phonectl.sh 缺 open_search action 分支"; exit 1; }
grep -q "cmd_open_search_evidence" scripts/openclaw/adb-controller-bridge.sh \
  || { echo "FAIL: adb-controller-bridge.sh 缺 open-search-evidence 命令实现"; exit 1; }
node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js \
  || { echo "FAIL: adb-controller-bridge.sh 单测退出码非零"; exit 1; }
echo "✅ 件3 open_search 冒烟全绿"
