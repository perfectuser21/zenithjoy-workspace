#!/usr/bin/env bash
# agent-cmd-executor-smoke.sh — OpenClaw 信号桥·件1 冒烟
# 1) command 包全部单测通过  2) 关键接线存在（grep 源码级断言）
set -euo pipefail
cd "$(dirname "$0")/../../../.."

AGENT_DIR="services/agent-android"
SRC="$AGENT_DIR/app/src/main/kotlin/com/zenithjoy/agent"

echo "== [1/2] 源码接线断言 =="
grep -q '"cmd"' "$SRC/AgentService.kt" || { echo "FAIL: AgentService 未路由 cmd"; exit 1; }
grep -q 'routeCommand' "$SRC/AgentService.kt" || { echo "FAIL: routeCommand 缺失"; exit 1; }
grep -q 'busyProbe' "$SRC/WsClient.kt" || { echo "FAIL: heartbeat busy 探针缺失"; exit 1; }
if grep -q 'connecting to \$wsUrl' "$SRC/WsClient.kt"; then
  echo "FAIL: WsClient 仍打印含 token 的完整 wsUrl（logcat 泄漏）"; exit 1
fi
grep -q 'AutomationLease.isHeldByOther' "$SRC/collect/DouyinCollectService.kt" || { echo "FAIL: 采集入口无 lease 守卫"; exit 1; }
grep -q 'AutomationLease.isHeldByOther' "$SRC/collect/DouyinDmOutreachService.kt" || { echo "FAIL: 私信入口无 lease 守卫"; exit 1; }
grep -q 'AutomationLease.isHeldByOther' "$SRC/account/DeviceAccountScanService.kt" || { echo "FAIL: 扫描入口无 lease 守卫"; exit 1; }
echo "OK: 接线断言全过"

echo "== [2/2] command 包单测 =="
# local.properties 的 sdk.dir 也算有 SDK（本地 homebrew android-commandlinetools 装法）
if [ -z "${ANDROID_HOME:-}" ] && [ ! -d "$HOME/Library/Android/sdk" ] && [ ! -d "/usr/local/lib/android/sdk" ] \
  && ! grep -q '^sdk.dir=' "$AGENT_DIR/local.properties" 2>/dev/null; then
  echo "SKIP: 无 Android SDK（CI android-agent-ci.yml 会跑全量单测兜底）"
  exit 0
fi
cd "$AGENT_DIR"
./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.command.*" --console=plain 2>&1 | tail -5
RESULTS_DIR="app/build/test-results/testDebugUnitTest"
if grep -rl 'failures="[1-9]' "$RESULTS_DIR" 2>/dev/null | head -1 | grep -q .; then
  echo "FAIL: command 包存在失败用例"; exit 1
fi
echo "OK: agent-cmd-executor smoke 全绿"
