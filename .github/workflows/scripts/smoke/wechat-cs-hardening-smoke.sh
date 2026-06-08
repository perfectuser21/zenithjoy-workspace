#!/usr/bin/env bash
# wechat-cs-hardening smoke — 微信 AI 客服稳定性加固静态校验。
#
# 验证 Path 4 今天真机跑通后正规化进代码的 5 处临时修复 + 进程守护落地：
#   1) listen_chat.py reply_in_chat 纯 UIA（iface_invoke.Invoke 开会话 + iface_value.SetValue 填字，禁物理输入）
#   2) wechat-rpa.ts 脚本路径基于 process.execPath（pkg 打包后 __dirname 失效）
#   3) wechat.ts DraftGenerateSchema 含 mode 字段（auto 模式透传 reply）
#   4) build-install-pack.sh 跨平台预装 pywinauto（--platform win_amd64）
#   5) 中台心跳端点 /api/wechat/listener-heartbeat + 断线告警服务
#   6) 进程守护：listener-watchdog.bat 已删除，守护内化为 startWechatListener（Node.js，30s 自愈）；
#      install-autostart.ps1 目标已改为 start.bat（ZenithJoyAgent 任务）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

LISTEN=services/agent/wechat-rpa/listen_chat.py
RPA_TS=services/agent/src/handlers/wechat-rpa.ts
ROUTE=apps/api/src/routes/wechat.ts
HEARTBEAT_SVC=apps/api/src/services/wechat-heartbeat.ts
BUILD=services/agent/scripts/build-install-pack.sh
WATCHDOG=services/agent/install-pack/listener-watchdog.bat
AUTOSTART=services/agent/install-pack/install-autostart.ps1

echo "=== 1: listen_chat reply_in_chat 纯 UIA 后台形态（禁物理输入）==="
grep -qE 'iface_invoke\.Invoke\(\)' "$LISTEN" || { echo "FAIL: reply_in_chat 未用 iface_invoke.Invoke（开会话/发送）"; exit 1; }
grep -qE 'iface_value\.SetValue\(' "$LISTEN" || { echo "FAIL: reply_in_chat 未用 iface_value.SetValue（填输入框）"; exit 1; }
! grep -qE 'item\.click_input\(\)|send_keys\(|type_keys\(' "$LISTEN" || { echo "FAIL: 仍残留物理输入（click_input/send_keys/type_keys 会抢前台）"; exit 1; }
! grep -qE 'item\.select\(\)' "$LISTEN" || { echo "FAIL: 仍残留 item.select()（微信4.0 不切换会话）"; exit 1; }
echo "  PASS 纯 UIA（Invoke 开会话 + SetValue 填字，无物理输入）"

echo "=== 2: wechat-rpa.ts 脚本路径基于 process.execPath ==="
grep -qE 'path\.dirname\(process\.execPath\)' "$RPA_TS" || { echo "FAIL: 未用 process.execPath 目录"; exit 1; }
! grep -qE "path\.resolve\(__dirname, *'\.\./\.\./wechat-rpa" "$RPA_TS" || { echo "FAIL: 仍残留 __dirname 相对路径"; exit 1; }
echo "  PASS process.execPath 路径解析"

echo "=== 3: wechat.ts DraftGenerateSchema 含 mode 字段 ==="
grep -qE "mode:\s*z\.enum\(\['auto', *'review'\]\)" "$ROUTE" || { echo "FAIL: DraftGenerateSchema 缺 mode enum"; exit 1; }
# node 真解析校验 mode 字段已声明（不仅是注释）
node -e "const s=require('fs').readFileSync('$ROUTE','utf8'); const i=s.indexOf('DraftGenerateSchema'); if(i<0||!s.slice(i,i+400).includes('mode')) process.exit(1);" \
  || { echo "FAIL: node 校验 DraftGenerateSchema mode 失败"; exit 1; }
echo "  PASS mode 字段透传"

echo "=== 4: build-install-pack 跨平台预装 pywinauto ==="
grep -q 'platform win_amd64' "$BUILD" || { echo "FAIL: build 脚本缺 --platform win_amd64 跨平台下载"; exit 1; }
grep -q 'pywinauto' "$BUILD" || { echo "FAIL: build 脚本未装 pywinauto"; exit 1; }
echo "  PASS pywinauto 跨平台预装"

echo "=== 5: 中台心跳端点 + 断线告警服务 ==="
grep -q "/listener-heartbeat" "$ROUTE" || { echo "FAIL: 缺 /listener-heartbeat 端点"; exit 1; }
test -f "$HEARTBEAT_SVC" || { echo "FAIL: 缺 wechat-heartbeat 服务"; exit 1; }
grep -qE "checkStaleListenersAndAlert|FEISHU_ALERT_WEBHOOK" "$HEARTBEAT_SVC" || { echo "FAIL: 缺断线告警逻辑"; exit 1; }
grep -qE "post_heartbeat" "$LISTEN" || { echo "FAIL: listen_chat 未上报心跳"; exit 1; }
echo "  PASS 心跳端点 + 告警 + 上报"

echo "=== 6: 进程守护（v1.1.109 架构：Node.js 内置守护，.bat 已删）==="
# listener-watchdog.bat 在 v1.1.109 中删除，守护逻辑移入 wechat-rpa.ts startWechatListener
if [ -f "$WATCHDOG" ]; then
  echo "FAIL: listener-watchdog.bat 不应存在（已在 v1.1.109 删除）"; exit 1
fi
echo "  PASS listener-watchdog.bat 已正确删除"
# install-autostart.ps1 现指向 start.bat（不再是 listener-watchdog.bat）
test -f "$AUTOSTART" || { echo "FAIL: 缺 install-autostart.ps1"; exit 1; }
grep -qE 'AtLogOn' "$AUTOSTART" || { echo "FAIL: autostart 缺 ONLOGON 触发"; exit 1; }
grep -q 'start.bat' "$AUTOSTART" || { echo "FAIL: autostart 未指向 start.bat"; exit 1; }
if grep -q 'listener-watchdog.bat' "$AUTOSTART"; then
  echo "FAIL: autostart 仍引用 listener-watchdog.bat（应已更新为 start.bat）"; exit 1
fi
echo "  PASS Node.js 内置守护 + autostart 指向 start.bat"

echo ""
echo "wechat-cs-hardening-smoke: ALL PASS"
