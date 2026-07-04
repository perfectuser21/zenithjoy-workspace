#!/usr/bin/env bash
# TDD — 进程守护脚本契约（Agent 内置守护 + 开机自启）。
# Windows-only 部署脚本（.bat/.ps1）无法在 CI Linux 上真跑，用静态契约测试锁定关键构造。
#
# v1.1.109 架构变更：listener-watchdog.bat 已删除，守护逻辑移入 Node.js Agent
# (startWechatListener in wechat-rpa.ts，含 30s 自愈循环)。
# install-autostart.ps1 目标已更新为 start.bat（zenithjoy-agent.exe）。
set -euo pipefail

PACK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUTOSTART="$PACK_DIR/install-autostart.ps1"

fail() { echo "FAIL: $1"; exit 1; }

echo "[test] 1: listener-watchdog.bat 已不存在（守护逻辑已移入 Node.js Agent）"
if [ -f "$PACK_DIR/listener-watchdog.bat" ]; then
  fail "listener-watchdog.bat 不应存在：守护已由 startWechatListener 内化"
fi
echo "  OK — listener-watchdog.bat 已正确删除"

echo "[test] 2: install-autostart.ps1 存在"
test -f "$AUTOSTART" || fail "缺 install-autostart.ps1"

echo "[test] 3: autostart 注册/注销 + ONLOGON 触发"
grep -q 'Register-ScheduledTask' "$AUTOSTART" || fail "缺 Register-ScheduledTask"
grep -q 'Unregister-ScheduledTask' "$AUTOSTART" || fail "缺 Unregister-ScheduledTask（注销支持）"
grep -qiE 'AtLogOn|ONLOGON' "$AUTOSTART" || fail "缺 登录触发（ONLOGON / -AtLogOn）"

echo "[test] 4: autostart 指向 start.bat（Agent 主进程），不再是 listener-watchdog.bat"
grep -q "start.bat" "$AUTOSTART" || fail "autostart 未指向 start.bat"
if grep -q "listener-watchdog.bat" "$AUTOSTART"; then
  fail "autostart 仍引用 listener-watchdog.bat（应已更新为 start.bat）"
fi

echo "[test] 5: autostart 以登录用户身份运行"
grep -qiE 'USERNAME|User ' "$AUTOSTART" || fail "缺 以当前登录用户身份运行"

echo "[test] 6: autostart 清理残留的旧版本残留计划任务（root cause 2026-07-04 rog 多循环打架）"
# 根因：过去调试在客户机上留下了自定义命名的计划任务（ZJAgent/ZJClean/restart_agent 等），
# 各自指向不同旧版本目录。旧版本 start.bat 没有 launcher 互斥锁（decision 72740815），
# 只要任一次触发（重启/StartWhenAvailable 追赶）就会同时唤起多个互不知情的永生 supervise
# 循环，互相 taskkill+relaunch 打架、狂开窗口。register 前必须先枚举并清掉这些同类残留。
grep -q 'Get-ScheduledTask' "$AUTOSTART" || fail "缺 枚举现有计划任务（清理残留的前提）"
grep -qiE 'zenithjoy-agent-v' "$AUTOSTART" || fail "缺 匹配旧版本安装路径的清理逻辑"
grep -qiE '\$_\.TaskName -ne \$TaskName' "$AUTOSTART" || fail "缺 排除自身任务名的清理条件（否则会清掉正牌任务）"

echo "[test] OK — 进程守护脚本契约满足（v1.1.109 架构 + 残留任务清理）"
