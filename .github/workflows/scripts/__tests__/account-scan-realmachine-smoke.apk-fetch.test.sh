#!/usr/bin/env bash
# account-scan-realmachine-smoke.apk-fetch.test.sh — TDD Red 阶段
#
# 复现 PR#1558 遗留 bug（task 1d087bfe-cf40-4d28-a5b4-76383565510e）：
# account-scan-realmachine-smoke.sh 原实现 curl `$API_BASE/api/agent/install-pack/android`
# 拿 APK 下载地址——但该端点是给浏览器登录客户用的 better-auth session cookie 鉴权端点
# （见 apps/api/src/routes/agent-install-pack.ts:360-372，`auth.api.getSession(...)`，
# 未登录返回 401；android-onboarding-smoke.sh:7-10 已明确断言"无 session → 401"这一行为
# 本身是设计如此）。CI self-hosted runner（xian-rog）没有浏览器 session，这个 401 是必然的、
# 每次都会发生的——Step 1 在拿到 401 后 apk_url 解析为空，直接 envfail(exit 3) 退出，
# 从未执行任何 adb install/adb shell 命令（已用真实 gh run 30499110576 日志核实）。
#
# 本测试用假 adb/ssh 可执行文件 + 本地 mock HTTP 服务器（模拟生产真实的"无 session → 401"
# 行为）在完全隔离、无需真机/无需真实网络的前提下复现并锁死这条回归：
#   - 旧实现：Step 1 卡在 install-pack/android 的 401 上，adb install 从未被调用 → 测试判红
#   - 新实现：Step 1 改为直连 ANDROID_APK_COS_URL（公网 COS 直链，同服务端约定），
#     成功下载 + adb install -r 被真实调用，脚本继续往下走到 Step 2（因假 ssh 查无 agent_id
#     而 envfail，属预期——本测试只锁 Step 1 这一段回归，Step 2/3 由其余既有测试覆盖）
#
# 用法: bash account-scan-realmachine-smoke.apk-fetch.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh APK 拉取回归测试"
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
ADB_LOG="$WORKDIR/adb.log"
SSH_LOG="$WORKDIR/ssh.log"
: > "$ADB_LOG"
: > "$SSH_LOG"

# ── 假 adb：devices 上线一台设备；install 记账；shell 系列返回可预测值 ──
cat > "$FAKE_BIN/adb" << ADBEOF
#!/usr/bin/env bash
echo "adb \$*" >> "$ADB_LOG"
case "\$1" in
  devices)
    echo "List of devices attached"
    echo -e "emulator-5554\\tdevice"
    ;;
  install)
    APKPATH="\${3:-}"
    if [ -f "\$APKPATH" ]; then
      SIZE=\$(wc -c < "\$APKPATH" | tr -d ' ')
      echo "install-ok size=\$SIZE" >> "$ADB_LOG"
    fi
    echo "Success"
    ;;
  shell)
    shift
    ARGS="\$*"
    case "\$ARGS" in
      "settings put secure enabled_accessibility_services"*) : ;;
      "settings get secure enabled_accessibility_services")
        echo "com.zenithjoy.agent/com.zenithjoy.agent.AccessibilityService" ;;
      "getprop ro.product.model") echo "TestModel" ;;
      *) : ;;
    esac
    ;;
  logcat) : ;;
  *) : ;;
esac
exit 0
ADBEOF
chmod +x "$FAKE_BIN/adb"

# ── 假 ssh：始终返回空（模拟 DB 查无匹配），用于屏蔽 Step 2/3 的真实网络依赖 ──
cat > "$FAKE_BIN/ssh" << SSHEOF
#!/usr/bin/env bash
echo "ssh \$*" >> "$SSH_LOG"
exit 0
SSHEOF
chmod +x "$FAKE_BIN/ssh"

# ── 本地 mock API：GET /api/acquisition/overview → 200；
#    GET /api/agent/install-pack/android → 401（生产真实行为：无浏览器 session 必 401）；
#    GET /fake-apk → 200 + 二进制体（模拟公网 COS 直链）──
PORT=$((30000 + RANDOM % 9000))
ACCESS_LOG="$WORKDIR/access.log"
cat > "$WORKDIR/mock_server.py" << PYEOF
import http.server, sys

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        with open("$ACCESS_LOG", "a") as f:
            f.write((fmt % args) + "\n")

    def do_GET(self):
        if self.path.startswith('/api/acquisition/overview'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        elif self.path.startswith('/api/agent/install-pack/android'):
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":false,"code":"UNAUTHORIZED"}')
        elif self.path.startswith('/fake-apk'):
            body = b'FAKEAPKDATA' * 100
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.android.package-archive')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path.startswith('/api/acquisition/account-scan/trigger'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"data":{"task_id":"test-task-id"}}')
        else:
            self.send_response(404)
            self.end_headers()

http.server.HTTPServer(('127.0.0.1', $PORT), Handler).serve_forever()
PYEOF

python3 "$WORKDIR/mock_server.py" &
SERVER_PID=$!

# 等待 mock server 就绪
READY=0
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/acquisition/overview" && { READY=1; break; }
  sleep 0.2
done
[ "$READY" -eq 1 ] || { echo "❌ mock server 未就绪"; exit 1; }

# ── 执行被测脚本 ──
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

# 断言 1: Step 1 必须成功（"已覆盖安装最新 APK"出现在输出里）
if printf '%s' "$OUTPUT" | grep -q "已覆盖安装最新 APK"; then
  echo "✅ PASS: Step 1 (adb install -r) 成功执行"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: Step 1 未成功——脚本仍卡在需要浏览器 session 的 install-pack/android 端点上"
  FAILED=$((FAILED+1))
fi

# 断言 2: 不应再出现旧的 "install-pack/android 未返回 apk_url" envfail 消息
if printf '%s' "$OUTPUT" | grep -q "install-pack/android 未返回 apk_url"; then
  echo "❌ FAIL: 仍在依赖需要浏览器 session 鉴权的 /api/agent/install-pack/android 端点"
  FAILED=$((FAILED+1))
else
  echo "✅ PASS: 未再依赖需要浏览器 session 鉴权的 install-pack/android 端点"
  PASSED=$((PASSED+1))
fi

# 断言 3: mock server 访问日志里不应出现对 install-pack/android 的真实请求
if [ -f "$ACCESS_LOG" ] && grep -q "install-pack/android" "$ACCESS_LOG"; then
  echo "❌ FAIL: 脚本仍在请求 /api/agent/install-pack/android（access log 命中）"
  FAILED=$((FAILED+1))
else
  echo "✅ PASS: 脚本未请求 /api/agent/install-pack/android（access log 未命中，已改走 COS 直链）"
  PASSED=$((PASSED+1))
fi

# 断言 4: 假 adb 的 install 调用记录必须存在（真实执行了 adb install -r）
if grep -q "install-ok" "$ADB_LOG"; then
  echo "✅ PASS: adb install -r 被真实调用（adb.log 命中 install-ok）"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: adb install -r 从未被调用（adb.log 未命中 install-ok）"
  FAILED=$((FAILED+1))
fi

echo ""
echo "APK 拉取回归测试: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
