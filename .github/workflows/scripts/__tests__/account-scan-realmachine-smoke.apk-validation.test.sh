#!/usr/bin/env bash
# account-scan-realmachine-smoke.apk-validation.test.sh — TDD Red 阶段
#
# 跟进 fix-realmachine-apk-fetch-401（task 1d087bfe-cf40-4d28-a5b4-76383565510e）
# 的第二轮加固：修 401 bug 后，nightly run 30500054381 首次真正跑到 adb 层，
# 暴露出旧代码的两个隐患（均已用真实 xian-rog 设备 SSH 复现确认过）：
#
#   隐患①：curl 下载 exit code 0 不代表内容是合法 APK——COS 直链一旦返回
#          403/html 错误页，旧代码会原样把这段文本当 APK 传给 adb install，
#          adb 会报一个和真实原因（下载内容错误）毫不相关的失败信息，
#          排查者要重新手动下载才能发现，浪费一轮真机排查。
#   隐患②：`"$ADB" install -r "$APK_TMP" >/dev/null 2>&1` 把 adb 的真实 stderr
#          整个吞掉，envfail 只留一句"adb install -r 失败"——真实根因
#          （如 INSTALL_FAILED_UPDATE_INCOMPATIBLE 签名不匹配 / 存储不足等）
#          必须重新登真机手跑一遍 adb install 才能看到（本次 debug 已实际
#          发生：xian-rog 设备手动复现出 "INSTALL_FAILED_UPDATE_INCOMPATIBLE:
#          Existing package com.zenithjoy.agent signatures do not match newer
#          version" 才第一次看到真实原因）。
#
# 本测试锁死两条修复：
#   Test A（隐患①回归）：mock server 在 /fake-apk 返回一段 HTML 错误页（非
#          zip/APK 内容）——脚本必须在文件校验阶段就 envfail，消息含"不是
#          合法 APK"，且假 adb 的 install 从未被调用（adb.log 不含 install）。
#   Test B（隐患②回归）：假 adb 的 install 子命令模拟真实失败并输出一段
#          具体 stderr 文本——envfail 消息必须原样包含这段文本，不能只有
#          "adb install -r 失败"这句泛化提示。
#
# 用法: bash account-scan-realmachine-smoke.apk-validation.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh APK 校验 + adb stderr 透传回归测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "🟠 SKIP: 本地无 python3，跳过（CI runner 均有 python3）"; exit 0; }

PASSED=0
FAILED=0

# ─────────────────────────────────────────────────────────
# 公共 harness：起一套假 adb/ssh + mock server，跑脚本，返回 stdout+exit code
# 参数: $1=fake_apk_mode(html|valid)  $2=fake_install_behavior(ok|fail_with_msg)
# ─────────────────────────────────────────────────────────
run_scenario() {
  local apk_mode="$1"
  local install_behavior="$2"

  local WORKDIR; WORKDIR=$(mktemp -d)
  local FAKE_BIN="$WORKDIR/bin"
  mkdir -p "$FAKE_BIN"
  local ADB_LOG="$WORKDIR/adb.log"
  : > "$ADB_LOG"

  cat > "$FAKE_BIN/adb" << ADBEOF
#!/usr/bin/env bash
echo "adb \$*" >> "$ADB_LOG"
case "\$1" in
  devices)
    echo "List of devices attached"
    echo -e "emulator-5554\\tdevice"
    ;;
  install)
    if [ "$install_behavior" = "fail_with_msg" ]; then
      echo "Performing Streamed Install" >&2
      echo "adb.exe: failed to install ...: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.zenithjoy.agent signatures do not match newer version; ignoring!]" >&2
      exit 1
    fi
    echo "install-ok" >> "$ADB_LOG"
    echo "Success"
    ;;
  shell)
    shift
    case "\$*" in
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

  cat > "$FAKE_BIN/ssh" << 'SSHEOF'
#!/usr/bin/env bash
exit 0
SSHEOF
  chmod +x "$FAKE_BIN/ssh"

  local PORT=$((30000 + RANDOM % 9000))
  cat > "$WORKDIR/mock_server.py" << PYEOF
import http.server, sys

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
            if "$apk_mode" == "html":
                body = b'<html><body>403 Forbidden - DownloadForbidden</body></html>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
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
  local SERVER_PID=$!

  local READY=0
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api/acquisition/overview" && { READY=1; break; }
    sleep 0.2
  done

  local OUTPUT="" CODE=0
  if [ "$READY" -eq 1 ]; then
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
  fi

  kill "$SERVER_PID" >/dev/null 2>&1
  echo "$OUTPUT"
  echo "##ADBLOG-START##"
  cat "$ADB_LOG"
  echo "##ADBLOG-END##"
  echo "##CODE=$CODE##"
  rm -rf "$WORKDIR"
}

# ── Test A: COS 返回 HTML 错误页，非 APK 内容 ──
echo ""
echo "── Test A: 下载内容非法(HTML错误页)必须在校验阶段拦截 ──"
RESULT_A=$(run_scenario "html" "ok")
if printf '%s' "$RESULT_A" | grep -q "不是合法 APK"; then
  echo "✅ PASS [A1]: envfail 消息含'不是合法 APK'"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL [A1]: 未见到'不是合法 APK'校验拦截消息"
  FAILED=$((FAILED+1))
fi
if printf '%s' "$RESULT_A" | sed -n '/##ADBLOG-START##/,/##ADBLOG-END##/p' | grep -q "install-ok"; then
  echo "❌ FAIL [A2]: 非法内容仍被传给 adb install 执行了（install-ok 命中，校验形同虚设）"
  FAILED=$((FAILED+1))
else
  echo "✅ PASS [A2]: adb install 从未被调用（内容校验在 install 之前拦截生效）"
  PASSED=$((PASSED+1))
fi

# ── Test B: adb install 真实失败，stderr 必须原样透传进 envfail ──
echo ""
echo "── Test B: adb install 失败时原始 stderr 必须透传进 envfail 留痕 ──"
RESULT_B=$(run_scenario "valid" "fail_with_msg")
if printf '%s' "$RESULT_B" | grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE"; then
  echo "✅ PASS [B]: envfail 消息包含 adb 原始 stderr(INSTALL_FAILED_UPDATE_INCOMPATIBLE)"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL [B]: envfail 消息未包含 adb 原始 stderr——仍在吞掉真实报错，排查者看不到根因"
  FAILED=$((FAILED+1))
fi

echo ""
echo "APK 校验 + adb stderr 透传回归测试: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
