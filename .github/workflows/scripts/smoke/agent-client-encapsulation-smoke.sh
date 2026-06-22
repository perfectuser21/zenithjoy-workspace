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

# 失败统一走 stderr，带 [smoke] 前缀 + 具体原因，便于 CI 日志定位
fail() { echo "[smoke] FAIL: $1" >&2; exit 1; }
# require <file> <pattern> <reason>：文件不存在或 pattern 缺失都报明确原因（不静默退出）
require() {
  local file="$1" pat="$2" reason="$3"
  [ -f "$file" ] || fail "$reason（文件不存在: $file）"
  grep -Eq "$pat" "$file" || fail "$reason（$file 未命中: $pat）"
}

echo "▶ Step 1/5: start.vbs 无窗口入口 + 日志轮转"
require "$VBS" '\.Run\b.*,[[:space:]]*0[[:space:]]*,' "start.vbs 未用 windowStyle=0 隐藏启动"
require "$VBS" 'start\.bat' "start.vbs 未拉起 start.bat"
require "$VBS" 'launch\.log' "start.vbs 未写 launch.log"
require "$VBS" '1048576|\.Size|GetFile' "start.vbs 缺日志大小轮转"

echo "▶ Step 2: 单实例守卫 + 拉起失败留痕"
require "$VBS" 'Win32_Process' "start.vbs 缺 WMI 进程探测"
require "$VBS" 'zenithjoy-agent\.exe' "start.vbs 未探测 zenithjoy-agent.exe"
require "$VBS" 'Quit|skip|already' "start.vbs 未走已运行跳过分支"
require "$VBS" 'On Error|Err\.|ERROR' "start.vbs 缺错误处理/失败留痕（R2）"

echo "▶ Step 3: tray.ts 零 powershell + 走 node-notifier（运行期不 spawn powershell）"
[ -f "$TRAY" ] || fail "tray.ts 不存在: $TRAY"
if grep -q 'powershell' "$TRAY"; then fail "tray.ts 仍含 powershell 通知路径（去黑窗硬保证被破坏）"; fi
require "$TRAY" 'node-notifier' "tray.ts 未走 node-notifier"
require "$TRAY" 'showModuleError' "tray.ts 缺 showModuleError"
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
require "$AUTOSTART" 'start\.vbs' "install-autostart.ps1 未指向 start.vbs"
if grep -Eq "Target\s*=.*start\.bat'" "$AUTOSTART"; then fail "自启目标仍是 start.bat"; fi

echo "▶ Step 5: start.bat probe 守卫 + 打包 + 依赖"
require "$BAT" 'ZJ_LAUNCH_PROBE' "start.bat 缺 ZJ_LAUNCH_PROBE 守卫"
require "$BAT" 'Get-Process -Name zenithjoy-agent' "start.bat 破坏了单实例 kill 回归"
require "$BUILD" 'install-pack/start\.vbs' "build-install-pack.sh 未拷 start.vbs"
[ -f "$PKG" ] || fail "package.json 不存在: $PKG"
node -e "const p=require('./$PKG'); if(!(p.dependencies&&p.dependencies['node-notifier'])) process.exit(1)" \
  || fail "package.json 缺 node-notifier 依赖"

echo "✅ agent-client-encapsulation smoke 全过（机制层；视觉/重启接缝见 contract 接缝清单）"
