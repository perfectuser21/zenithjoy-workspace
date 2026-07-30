#!/usr/bin/env bash
# account-scan-realmachine-smoke.accessibility-service-name.test.sh — TDD Red 阶段
#
# 复现真实 bug（task 1d087bfe-cf40-4d28-a5b4-76383565510e，xian-rog 真机 run
# 30504984680 首次执行到这一行才暴露——之前一直被 401/签名冲突挡在更早的步骤，
# 从未真正跑到过）：
#
# 旧代码 `adb shell settings put secure enabled_accessibility_services
# 'com.zenithjoy.agent/com.zenithjoy.agent.AccessibilityService'` 写的是一个
# APK 里**从不存在**的虚构组件名——真机 `adb shell dumpsys package com.zenithjoy.agent`
# 的 Service Resolver Table 实测确认三个真实无障碍服务分别是
# `.collect.DouyinCollectService` / `.collect.DouyinDmOutreachService` /
# `.account.DeviceAccountScanService`（与 AgentService.kt 的
# REQUIRED_ACCESSIBILITY_SERVICES 权威清单一致）。写入不存在的组件名后，
# `enabled_accessibility_services` 读回是 null，脚本判定"无障碍服务未开启"，
# 账号扫描永远无法进行——这个 bug 存在了很久但从未被任何测试捕获，因为旧的
# fake adb 测试 harness 里 `settings get` 是硬编码回声，不校验 `settings put`
# 真实写了什么，等价于测试了个寂寞。
#
# 本测试用一个"有状态"的假 adb（真实存 `settings put` 写入的值，`settings get`
# 原样读回，模拟真机行为）锁死这条回归：脚本必须写入包含
# `DeviceAccountScanService` 的正确组件名，而不是虚构的 `AccessibilityService`。
#
# 用法: bash account-scan-realmachine-smoke.accessibility-service-name.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh 无障碍服务组件名回归测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "🟠 SKIP: 本地无 python3，跳过（CI runner 均有 python3）"; exit 0; }

WORKDIR=$(mktemp -d)
cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" >/dev/null 2>&1
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"
# "有状态"的假 adb：settings put 真实持久化写入值到一个状态文件，
# settings get 原样读回——模拟真机 Settings.Secure 的行为，而不是硬编码回声。
STATE_FILE="$WORKDIR/enabled_accessibility_services.state"
: > "$STATE_FILE"

cat > "$FAKE_BIN/adb" << ADBEOF
#!/usr/bin/env bash
case "\$1" in
  devices)
    echo "List of devices attached"
    echo -e "emulator-5554\\tdevice"
    ;;
  install)
    echo "Success"
    ;;
  shell)
    shift
    if [ "\$1" = "am" ]; then
      : # 模拟 install -r 后 deeplink 重新拉起 App（本测试不关心这一步，只关心无障碍组件名）
    elif [ "\$1" = "pidof" ]; then
      echo "12345" # 模拟拉起后进程存活，让脚本能继续往下走到无障碍设置这一步
    elif [ "\$1" = "settings" ] && [ "\$2" = "put" ] && [ "\$3" = "secure" ] && [ "\$4" = "enabled_accessibility_services" ]; then
      printf '%s' "\$5" > "$STATE_FILE"
    elif [ "\$1" = "settings" ] && [ "\$2" = "get" ] && [ "\$3" = "secure" ] && [ "\$4" = "enabled_accessibility_services" ]; then
      if [ -s "$STATE_FILE" ]; then cat "$STATE_FILE"; else echo "null"; fi
    elif [ "\$1" = "settings" ] && [ "\$2" = "put" ] && [ "\$3" = "secure" ] && [ "\$4" = "accessibility_enabled" ]; then
      : # no-op，本测试只关心 enabled_accessibility_services 组件名是否正确
    elif [ "\$1" = "getprop" ]; then
      echo "TestModel"
    fi
    ;;
  logcat) : ;;
  *) : ;;
esac
exit 0
ADBEOF
chmod +x "$FAKE_BIN/adb"

# 需要给 envbind 修复新增的 license_key 查询一个非空回答，否则脚本会在
# 拉起 App、设置无障碍组件之前就因"查不到 active license_key"envfail
# （本测试关注点是无障碍组件名是否正确写入，不是 license 查询本身）。
cat > "$FAKE_BIN/ssh" << 'SSHEOF'
#!/usr/bin/env bash
CMD="$2"
if echo "$CMD" | grep -q "SELECT license_key FROM zenithjoy.licenses"; then
  echo "ZJ-TEST-FAKE0001"
  exit 0
fi
exit 0
SSHEOF
chmod +x "$FAKE_BIN/ssh"

PORT=$((30000 + RANDOM % 9000))
cat > "$WORKDIR/mock_server.py" << PYEOF
import http.server

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path.startswith('/api/acquisition/overview'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        elif self.path.startswith('/fake-apk'):
            body = b'PK' + b'FAKEAPKDATA' * 100
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.android.package-archive')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"data":{"task_id":"test-task-id"}}')

http.server.HTTPServer(('127.0.0.1', $PORT), Handler).serve_forever()
PYEOF

python3 "$WORKDIR/mock_server.py" &
SERVER_PID=$!

READY=0
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/acquisition/overview" && { READY=1; break; }
  sleep 0.2
done
[ "$READY" -eq 1 ] || { echo "❌ mock server 未就绪"; exit 1; }

set +e
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  ADB="$FAKE_BIN/adb" \
  API_BASE="http://127.0.0.1:$PORT" \
  ANDROID_APK_COS_URL="http://127.0.0.1:$PORT/fake-apk" \
  SMOKE_TENANT="test-tenant" \
  DB_SSH_HOST="fake-host" \
  POLL_MAX=1 POLL_INTERVAL=1 \
  bash "$SCRIPT" 2>&1)
CODE=$?
set -e

echo "$OUTPUT"
echo "── exit=$CODE ── 实际写入的组件名: $(cat "$STATE_FILE") ──"

PASSED=0
FAILED=0

if printf '%s' "$OUTPUT" | grep -q "无障碍已开启"; then
  echo "✅ PASS: 无障碍服务正确开启（写入的组件名被真机/模拟环境识别为有效）"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: 无障碍服务未开启——写入的组件名无效（历史 bug：虚构的 AccessibilityService 类名）"
  FAILED=$((FAILED+1))
fi

if grep -q "DeviceAccountScanService" "$STATE_FILE"; then
  echo "✅ PASS: 写入的组件名包含真实存在的 DeviceAccountScanService（account-scan 依赖的具体服务）"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: 写入的组件名不含 DeviceAccountScanService，实际写入: $(cat "$STATE_FILE")"
  FAILED=$((FAILED+1))
fi

echo ""
echo "无障碍服务组件名回归测试: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
