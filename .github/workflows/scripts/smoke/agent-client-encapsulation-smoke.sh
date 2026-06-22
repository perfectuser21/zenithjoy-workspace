#!/usr/bin/env bash
# agent-client-encapsulation-smoke.sh
# Smoke: Agent 客户端封装（去黑窗 + 托盘静默通知）机制层守卫。
# 跨平台 bash 可跑（源码层断言 + 运行期行为），对齐 contract-draft.md 各 Step 验证命令。
# 真实视觉/重启接缝（S1/S2/S3）在 windows_cloud e2e-verify.ps1 + 真目标 xian-pc 验。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

AGENT="services/agent"
VBS="$AGENT/install-pack/start.vbs"
TRAY="$AGENT/src/tray.ts"
AUTOSTART="$AGENT/install-pack/install-autostart.ps1"
BAT="$AGENT/install-pack/start.bat"
BUILD="$AGENT/scripts/build-install-pack.sh"
PKG="$AGENT/package.json"

fail() { echo "FAIL: $1"; exit 1; }

echo "▶ Step 1/5: start.vbs 无窗口入口 + 日志轮转"
[ -f "$VBS" ] || fail "start.vbs 不存在"
grep -Eq '\.Run\b.*,[[:space:]]*0[[:space:]]*,' "$VBS" || fail "start.vbs 未用 windowStyle=0 隐藏启动"
grep -q 'start\.bat' "$VBS" || fail "start.vbs 未拉起 start.bat"
grep -q 'launch\.log' "$VBS" || fail "start.vbs 未写 launch.log"
grep -Eq '1048576|\.Size|GetFile' "$VBS" || fail "start.vbs 缺日志大小轮转"

echo "▶ Step 2: 单实例守卫 + 拉起失败留痕"
grep -q 'Win32_Process' "$VBS" || fail "start.vbs 缺 WMI 进程探测"
grep -q 'zenithjoy-agent\.exe' "$VBS" || fail "start.vbs 未探测 zenithjoy-agent.exe"
grep -Eqi 'Quit|skip|already' "$VBS" || fail "start.vbs 未走已运行跳过分支"
grep -Eqi 'On Error|Err\.|ERROR' "$VBS" || fail "start.vbs 缺错误处理/失败留痕（R2）"

echo "▶ Step 3: tray.ts 零 powershell + 走 node-notifier（运行期不 spawn powershell）"
if grep -q 'powershell' "$TRAY"; then fail "tray.ts 仍含 powershell 通知路径"; fi
grep -q 'node-notifier' "$TRAY" || fail "tray.ts 未走 node-notifier"
grep -q 'showModuleError' "$TRAY" || fail "tray.ts 缺 showModuleError"
( cd "$AGENT" && npx tsx -e '
  const cp = require("node:child_process");
  let ps = false;
  const wrap = () => (...a) => { if (/powershell/i.test(String(a[0]||""))) ps = true; return { on(){}, unref(){} }; };
  cp.execFile = wrap(); cp.spawn = wrap(); cp.exec = wrap();
  const t = require("./src/tray.ts");
  t.showModuleError("微信 AI 客服", "需要安装微信");
  if (ps) { console.error("FAIL: showModuleError spawned powershell"); process.exit(1); }
  console.log("OK runtime no-powershell");
' ) || fail "运行期 showModuleError 触发了 powershell"

echo "▶ Step 4: install-autostart.ps1 指向 start.vbs"
grep -q 'start\.vbs' "$AUTOSTART" || fail "install-autostart.ps1 未指向 start.vbs"
if grep -Eq "Target\s*=.*start\.bat'" "$AUTOSTART"; then fail "自启目标仍是 start.bat"; fi

echo "▶ Step 5: start.bat probe 守卫 + 打包 + 依赖"
grep -q 'ZJ_LAUNCH_PROBE' "$BAT" || fail "start.bat 缺 ZJ_LAUNCH_PROBE 守卫"
grep -q 'Get-Process -Name zenithjoy-agent' "$BAT" || fail "start.bat 破坏了单实例 kill 回归"
grep -q 'install-pack/start\.vbs' "$BUILD" || fail "build-install-pack.sh 未拷 start.vbs"
node -e "const p=require('./$PKG'); if(!(p.dependencies&&p.dependencies['node-notifier'])) process.exit(1)" \
  || fail "package.json 缺 node-notifier 依赖"

echo "✅ agent-client-encapsulation smoke 全过（机制层；视觉/重启接缝见 contract 接缝清单）"
