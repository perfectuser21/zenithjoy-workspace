#!/usr/bin/env bash
# account-scan-realmachine-smoke.relaunch-after-install.test.sh — TDD Red 阶段
#
# 复现真实 bug（task 1d087bfe-cf40-4d28-a5b4-76383565510e，xian-rog 真机 run
# 30507062047 全链路首次跑到 Step 3 轮询才暴露）：
#
# `adb install -r` 触发 PACKAGE_REPLACED 会杀死正在跑的 AgentService 进程（含心跳
# 循环）——真机复现确认：pm replace 不会自动重启前台服务。旧代码 Step 1 从未显式
# 拉起 App，导致心跳循环永久停摆：last_heartbeat_at 停在杀死前的最后一次值，短时间
# 内仍落在 NO_ONLINE_ANDROID_AGENT 判定的 2 分钟新鲜窗口内，account-scan/trigger 会
# 误判"在线"成功派单，但没有活的心跳循环去拉取执行，任务永远卡 status=queued（真机
# 实测：task_id=6d78a764-e18c-47f0-a30a-05d2d205f5bc 18 次轮询/3分钟全部 queued，
# logcat 全程零 "ws1 task:" 记录，同队列里还躺着两条更早的 dm_outreach 旧任务同样
# 永久卡住，佐证这不是偶发）。
#
# 本测试用"有状态"假 adb（记录 monkey 启动调用，pidof 依据是否被启动过来响应）锁死：
# 脚本必须在 adb install -r 之后显式拉起 App，并验证 pidof 查到真实进程才算通过。
#
# 用法: bash account-scan-realmachine-smoke.relaunch-after-install.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh install后重启App回归测试"
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
LAUNCHED_FLAG="$WORKDIR/launched.flag"
rm -f "$LAUNCHED_FLAG"

# ── 有状态假 adb：模拟"install -r 杀死进程，只有 deeplink am start 才能重新拉起"──
# （2026-07-30 envbind 修复：泛泛的 monkey LAUNCHER 换成 zenithjoy://bind deeplink，
#  因为纯 monkey 拉起不会纠正设备残留的错误 apiUrl 绑定，见 envbind.test.sh）
cat > "$FAKE_BIN/adb" << ADBEOF
#!/usr/bin/env bash
case "\$1" in
  devices)
    echo "List of devices attached"
    echo -e "emulator-5554\\tdevice"
    ;;
  install)
    # install -r 模拟 PACKAGE_REPLACED 杀死进程：清掉 launched 标记
    rm -f "$LAUNCHED_FLAG"
    echo "Success"
    ;;
  shell)
    shift
    if [ "\$1" = "am" ]; then
      # am start -a android.intent.action.VIEW -d "zenithjoy://bind?..." → 模拟真正拉起 App
      touch "$LAUNCHED_FLAG"
    elif [ "\$1" = "pidof" ]; then
      if [ -f "$LAUNCHED_FLAG" ]; then echo "12345"; fi
    elif [ "\$1" = "settings" ] && [ "\$2" = "put" ] && [ "\$3" = "secure" ] && [ "\$4" = "enabled_accessibility_services" ]; then
      : # no-op
    elif [ "\$1" = "settings" ] && [ "\$2" = "get" ] && [ "\$3" = "secure" ] && [ "\$4" = "enabled_accessibility_services" ]; then
      echo "com.zenithjoy.agent/.collect.DouyinCollectService:com.zenithjoy.agent/.collect.DouyinDmOutreachService:com.zenithjoy.agent/.account.DeviceAccountScanService"
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
# 重新拉起 App 之前就因"查不到 active license_key"envfail，测试永远看不到本文件
# 要验的"install -r 后显式重新拉起 App"这一步（本测试的关注点在拉起本身，不是
# 后续 agent_id 定位，其余查询继续保持空响应即可，跟修复前行为一致）。
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
echo "── exit=$CODE ──"

PASSED=0
FAILED=0

if printf '%s' "$OUTPUT" | grep -q "已重新拉起 App"; then
  echo "✅ PASS: install -r 后显式重新拉起了 App"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: install -r 后没有重新拉起 App——心跳循环停摆，account-scan 必然拿不到 done"
  FAILED=$((FAILED+1))
fi

if [ -f "$LAUNCHED_FLAG" ]; then
  echo "✅ PASS: 假 adb 确认收到过 monkey LAUNCHER 拉起调用"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: 假 adb 从未收到 monkey LAUNCHER 拉起调用"
  FAILED=$((FAILED+1))
fi

echo ""
echo "install后重启App回归测试: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
