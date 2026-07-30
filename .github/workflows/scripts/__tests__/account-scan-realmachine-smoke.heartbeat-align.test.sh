#!/usr/bin/env bash
# account-scan-realmachine-smoke.heartbeat-align.test.sh — TDD 行为测试
#
# 复现真实 bug（task 1d087bfe，xian-rog 真机 run 30507775016 一路装包/拉起/开无障碍/
# 定位 agent_id 全绿，最后卡在 account-scan/trigger 返回 400 envfail）：
#
# 两个根因叠加，都让 trigger 查不到"在线 android agent"：
#   ① 心跳双字段不一致（issue 009c1544）：agent 的 ws 长连接心跳只更新 agents.last_seen，
#      不更新 last_heartbeat_at；而 account-scan/trigger 选设备用 last_heartbeat_at > now()-2min。
#      设备真在线(last_seen 持续刷新)却因 last_heartbeat_at 是旧值被判离线 → 400。
#   ② 脚本硬编码默认 tenant（SMOKE_TENANT 兜底 455a8ca9），但真机注册的 tenant 可能不同
#      （本次真机 MAA-AN00 实际 tenant=956f306e）→ trigger 按错 tenant 查不到设备 → 400。
#
# 修复：定位到设备真实 agent_id 后、触发之前，用该 agent 的真实 tenant_id 触发，并在确认
# last_seen 新鲜(设备真在线，不伪造离线设备)后把 last_heartbeat_at 对齐 now()。
#
# 本测试用有状态假 ssh（按 SQL 类型返回 tenant/last_seen/记录 UPDATE）+ 记录 tenant 的
# mock server 锁死两条行为：脚本必须①对 DB 发出 UPDATE last_heartbeat_at ②用 DB 查出的
# 真实 tenant 触发（而非硬编码 SMOKE_TENANT）。
#
# 用法: bash account-scan-realmachine-smoke.heartbeat-align.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh 触发前对齐心跳+真实tenant 回归测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ -f "$SCRIPT" ] || { echo "❌ RED（预期）: $SCRIPT 不存在"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "🟠 SKIP: 本地无 python3"; exit 0; }

WORKDIR=$(mktemp -d)
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" >/dev/null 2>&1; rm -rf "$WORKDIR"; }
trap cleanup EXIT

FAKE_BIN="$WORKDIR/bin"; mkdir -p "$FAKE_BIN"
UPDATED_FLAG="$WORKDIR/heartbeat_updated.flag"; rm -f "$UPDATED_FLAG"
REAL_TENANT="real-tenant-from-db-9c9c"

# ── 假 adb：设备在线、装包成功、拉起 App、无障碍开启、型号=TestModel ──
cat > "$FAKE_BIN/adb" << ADBEOF
#!/usr/bin/env bash
case "\$1" in
  devices) echo "List of devices attached"; echo -e "emulator-5554\\tdevice" ;;
  install) echo "Success" ;;
  shell)
    shift
    if [ "\$1" = "monkey" ]; then :
    elif [ "\$1" = "pidof" ]; then echo "12345"
    elif [ "\$1" = "settings" ] && [ "\$2" = "get" ]; then
      echo "com.zenithjoy.agent/.account.DeviceAccountScanService"
    elif [ "\$1" = "getprop" ]; then echo "TestModel"
    fi ;;
  logcat) echo "agent started — agentId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" ;;
  *) : ;;
esac
exit 0
ADBEOF
chmod +x "$FAKE_BIN/adb"

# ── 有状态假 ssh：按 SQL 类型返回 —— 关键是把"设备真在线的真实 tenant"和"last_seen 新鲜"
#    喂给脚本，并记录脚本是否发出了 UPDATE last_heartbeat_at ──
cat > "$FAKE_BIN/ssh" << SSHEOF
#!/usr/bin/env bash
CMD="\$2"
if echo "\$CMD" | grep -q "UPDATE zenithjoy.agents SET last_heartbeat_at"; then
  touch "$UPDATED_FLAG"; exit 0
fi
if echo "\$CMD" | grep -qi "SELECT tenant_id"; then
  # tenant_id | (last_seen 新鲜=t) —— 设备真在线
  echo "$REAL_TENANT|t"; exit 0
fi
if echo "\$CMD" | grep -qi "SELECT agent_id FROM"; then
  echo "agent-test-live"; exit 0
fi
if echo "\$CMD" | grep -qi "SELECT status"; then
  echo "done|{\"account_ids\":[\"测试账号A\"]}"; exit 0
fi
exit 0
SSHEOF
chmod +x "$FAKE_BIN/ssh"

# ── mock server：记录 trigger 收到的 X-Tenant-Id，返回 task_id ──
PORT=$((30000 + RANDOM % 9000))
TENANT_FILE="$WORKDIR/trigger_tenant.txt"; rm -f "$TENANT_FILE"
cat > "$WORKDIR/mock_server.py" << PYEOF
import http.server
TENANT_FILE = r"$TENANT_FILE"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/fake-apk'):
            body = b'PK' + b'FAKEAPK' * 100
            self.send_response(200); self.send_header('Content-Type','application/vnd.android.package-archive')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"ok":true}')
    def do_POST(self):
        with open(TENANT_FILE,'w') as f: f.write(self.headers.get('X-Tenant-Id','') or '')
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
        self.wfile.write(b'{"data":{"task_id":"test-task-id"}}')
http.server.HTTPServer(('127.0.0.1', $PORT), H).serve_forever()
PYEOF
python3 "$WORKDIR/mock_server.py" & SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/x" && break; sleep 0.2; done

set +e
PATH="$FAKE_BIN:$PATH" ADB="$FAKE_BIN/adb" \
  API_BASE="http://127.0.0.1:$PORT" ANDROID_APK_COS_URL="http://127.0.0.1:$PORT/fake-apk" \
  SMOKE_TENANT="hardcoded-wrong-tenant" DB_SSH_HOST="fake-host" POLL_MAX=1 POLL_INTERVAL=1 \
  bash "$SCRIPT" >/dev/null 2>&1
set -e

FAILED=0
if [ -f "$UPDATED_FLAG" ]; then
  echo "✅ PASS: 脚本触发前对 DB 发出了 UPDATE last_heartbeat_at（对齐心跳，补偿 issue 009c1544）"
else
  echo "❌ FAIL: 脚本触发前未对齐 last_heartbeat_at —— 设备真在线(last_seen新鲜)却会被 trigger 判离线 400"; FAILED=1
fi

TRIGGER_TENANT=$(cat "$TENANT_FILE" 2>/dev/null || echo "")
if [ "$TRIGGER_TENANT" = "$REAL_TENANT" ]; then
  echo "✅ PASS: 触发用了 DB 查出的真实 tenant（$TRIGGER_TENANT），不是硬编码 SMOKE_TENANT"
elif [ "$TRIGGER_TENANT" = "hardcoded-wrong-tenant" ]; then
  echo "❌ FAIL: 触发用了硬编码 SMOKE_TENANT，真机注册在别的 tenant 时必然 400"; FAILED=1
else
  echo "❌ FAIL: 触发 tenant 异常（收到='$TRIGGER_TENANT'，期望='$REAL_TENANT'）"; FAILED=1
fi

[ "$FAILED" -eq 0 ] && { echo "🟢 全部通过"; exit 0; } || { echo "🔴 有断言失败"; exit 1; }
