#!/usr/bin/env bash
# TDD — 进程守护脚本契约（watchdog 自愈 + 开机自启）。
# Windows-only 部署脚本（.bat/.ps1）无法在 CI Linux 上真跑，用静态契约测试锁定关键构造，
# 与 build-install-pack-pywinauto.test.sh 同策略。
#
# RED：listener-watchdog.bat / install-autostart.ps1 不存在 → 失败。
# GREEN：创建两脚本并含必要构造后通过。
set -euo pipefail

PACK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WATCHDOG="$PACK_DIR/listener-watchdog.bat"
AUTOSTART="$PACK_DIR/install-autostart.ps1"

fail() { echo "FAIL: $1"; exit 1; }

echo "[test] 1: listener-watchdog.bat 存在"
test -f "$WATCHDOG" || fail "缺 listener-watchdog.bat"

echo "[test] 2: watchdog 含重启循环（:loop ... goto loop）"
grep -qiE '^:loop' "$WATCHDOG" || fail "缺 :loop 标签"
grep -qiE 'goto loop' "$WATCHDOG" || fail "缺 goto loop 循环"

echo "[test] 3: watchdog 退出后 30 秒重启（timeout /t 30）"
grep -qE 'timeout /t 30' "$WATCHDOG" || fail "缺 30 秒重启等待"

echo "[test] 4: watchdog 启动 listen_chat.py + 用 python-embedded"
grep -q 'listen_chat.py' "$WATCHDOG" || fail "未启动 listen_chat.py"
grep -q 'python-embedded' "$WATCHDOG" || fail "未优先用 python-embedded"

echo "[test] 5: install-autostart.ps1 存在"
test -f "$AUTOSTART" || fail "缺 install-autostart.ps1"

echo "[test] 6: autostart 注册/注销 + ONLOGON 触发"
grep -q 'Register-ScheduledTask' "$AUTOSTART" || fail "缺 Register-ScheduledTask"
grep -q 'Unregister-ScheduledTask' "$AUTOSTART" || fail "缺 Unregister-ScheduledTask（注销支持）"
grep -qiE 'AtLogOn|ONLOGON' "$AUTOSTART" || fail "缺 登录触发（ONLOGON / -AtLogOn）"

echo "[test] 7: autostart 拉起 watchdog（以登录用户身份）"
grep -q 'listener-watchdog.bat' "$AUTOSTART" || fail "autostart 未指向 listener-watchdog.bat"
grep -qiE 'USERNAME|User ' "$AUTOSTART" || fail "缺 以当前登录用户身份运行"

echo "[test] OK — 进程守护脚本契约满足"
