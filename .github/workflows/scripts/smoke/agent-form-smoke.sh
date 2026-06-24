#!/usr/bin/env bash
# agent-form-smoke.sh
# Sprint 06240003 — Line04 Agent 客户端形态收口（悦升云端图标 + 安装包无窗）。
#
# 推进 Path 4：把客户安装的 Agent 收口成「显悦升云端 logo + 双击/自启都无黑窗」。
# 本 smoke 把能自动断言的四件钉死成回归守卫（真机肉眼验留给 lead）：
#
#   A) 安装入口只指 vbs：build-install-pack.sh 真生成一个无窗快捷方式（指向 start.vbs，
#      NOT start.bat），用户手动点不到会弹黑窗的 bat 入口（README 也不再叫人双击 start.bat）。
#   B) exe 应用图标（不破坏 overlay）：package:win 在 **pkg 之前**把 build/icon.ico 写进
#      base 二进制（scripts/prepare-base-icon.js），而**不是**在 pkg 打完后 rcedit 改 exe
#      （那会截断 pkg 追加的 snapshot overlay → 运行时 `Pkg: Error reading from file`，
#      就是 2.0.25 不可用的真因）。守卫钉死：① package:win 调 prepare-base-icon 且顺序在 pkg 前
#      ② 不再有「pkg 打完后对 exe 跑 set-exe-icon / rcedit」的坏法 ③ 旧坏脚本 set-exe-icon.js 已删。
#      icon.ico 资源真实存在且是 Windows icon 格式。
#   C) 托盘图标兜底非纯透明：tray.ts 读 build/tray-icon.png 失败时兜底成一个可辨识的悦升云端
#      占位 base64（绝不再是 1x1 透明 PNG = 用户看到的空白）。
#   D) 模块三版本面一致：本 sprint 不动 line04 模块版本，但守卫仍校验 modules/build-modules/心跳
#      三面相等（防误漂移）。
#
# 退出码：0 全过 / 2 缺工具 / 3 快捷方式入口未收口 / 4 exe 图标未接 / 5 托盘兜底仍纯透明
#         / 6 icon.ico 资源缺失 / 7 三版本面不一致
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/agent"
echo "agent-form-smoke: repo=$REPO_ROOT"

command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 2; }

BUILD_SH="$AGENT_DIR/scripts/build-install-pack.sh"
PKG_JSON="$AGENT_DIR/package.json"
TRAY_TS="$AGENT_DIR/src/tray.ts"
ICON_ICO="$AGENT_DIR/build/icon.ico"
README="$AGENT_DIR/install-pack/README.txt"

# ── A) 安装入口收口：build 脚本生成无窗快捷方式指向 vbs，README 不再叫双击 bat ──────────────
echo "[A] 安装入口只指 vbs（无可双击弹黑窗的 bat 入口）"
# build 脚本必须真生成一个指向 start.vbs 的快捷方式 / 启动器（create-shortcut 或 .lnk/启动器脚本）
grep -qE "start\.vbs" "$BUILD_SH" || { echo "FAIL: build-install-pack.sh 未引用 start.vbs"; exit 3; }
grep -qiE "shortcut|快捷方式|\.lnk|启动器|launcher" "$BUILD_SH" \
  || { echo "FAIL: build-install-pack.sh 未生成指向 vbs 的快捷方式/启动器"; exit 3; }
# README 不得再叫用户「双击 start.bat」（那会弹黑窗）。允许出现 start.bat 字样（内部说明），
# 但不得有「双击 ... start.bat」的引导。
if grep -nE "双击.*start\.bat|double.?click.*start\.bat" "$README" >/dev/null 2>&1; then
  echo "FAIL: README 仍引导用户双击 start.bat（会弹黑窗），必须改指 start.vbs 无窗入口"
  grep -nE "双击.*start\.bat" "$README" || true
  exit 3
fi
echo "  OK: 入口收口到 vbs"

# ── B) exe 图标在 pkg **之前**写进 base 二进制（不破坏 overlay）─────────────────────────────
echo "[B] exe 图标 = pkg 前嵌 base 二进制（不破坏 snapshot overlay）"
PREPARE_ICON_JS="$AGENT_DIR/scripts/prepare-base-icon.js"
PKG_WIN=$(node -e "process.stdout.write(require('$PKG_JSON').scripts['package:win']||'')")
echo "  package:win = $PKG_WIN"

# B1: 新机制脚本必须存在
[ -f "$PREPARE_ICON_JS" ] \
  || { echo "FAIL: 缺 scripts/prepare-base-icon.js（pkg 前嵌图标的新机制）"; exit 4; }

# B2: package:win 必须调 prepare-base-icon 写 icon.ico
echo "$PKG_WIN" | grep -qE "prepare-base-icon\.js" \
  || { echo "FAIL: package:win 未调 prepare-base-icon.js（pkg 前嵌图标）"; exit 4; }
echo "$PKG_WIN" | grep -qE "icon\.ico" \
  || { echo "FAIL: package:win 未引用 build/icon.ico"; exit 4; }

# B3: 顺序铁律 — prepare-base-icon 必须在 pkg **之前**（否则 overlay 仍会被截断）
ICON_POS=$(echo "$PKG_WIN" | grep -bo "prepare-base-icon" | head -1 | cut -d: -f1)
PKG_POS=$(echo "$PKG_WIN" | grep -bo "pkg \." | head -1 | cut -d: -f1)
if [ -z "$ICON_POS" ] || [ -z "$PKG_POS" ] || [ "$ICON_POS" -ge "$PKG_POS" ]; then
  echo "FAIL: package:win 中 prepare-base-icon 必须在 pkg 之前（icon_pos=$ICON_POS pkg_pos=$PKG_POS）"
  echo "      pkg 后再改 PE 资源会截断 overlay → 运行时 Pkg: Error reading from file（2.0.25 真因）"
  exit 4
fi

# B4: 坏法回归守卫 — package:win 不得在 pkg **之后** rcedit / set-exe-icon 改 exe
if echo "$PKG_WIN" | grep -qE "set-exe-icon|--set-icon"; then
  echo "FAIL: package:win 仍含 pkg 后处理改图标的坏法（set-exe-icon / --set-icon），会截断 overlay"
  exit 4
fi
# 旧坏脚本必须已删（pkg 打完后 rcedit exe 的那份）
if [ -f "$AGENT_DIR/scripts/set-exe-icon.js" ]; then
  echo "FAIL: 旧坏脚本 scripts/set-exe-icon.js 仍在（pkg 后 rcedit exe → 截断 overlay），必须删除"
  exit 4
fi

# B5: prepare-base-icon 必须在 pkg **之前**嵌图标，不能在 exe 末尾追加后改 PE
grep -qE "need\(|pkg-fetch" "$PREPARE_ICON_JS" \
  || { echo "FAIL: prepare-base-icon.js 未用 pkg-fetch.need() 拿 base 二进制（无法保证 pkg 用同一份）"; exit 4; }
grep -qE "rcedit" "$PREPARE_ICON_JS" \
  || { echo "FAIL: prepare-base-icon.js 未用 rcedit 写图标"; exit 4; }

# rcedit + pkg-fetch 必须在 devDependencies（CI windows runner 能装到）
node -e "const p=require('$PKG_JSON');process.exit(p.devDependencies&&p.devDependencies.rcedit?0:1)" \
  || { echo "FAIL: rcedit 未在 devDependencies"; exit 4; }
echo "  OK: 图标在 pkg 前嵌 base 二进制（prepare-base-icon.js），无 pkg 后处理坏法"

# ── C) icon.ico 资源存在且是 Windows icon 格式 ───────────────────────────────────────────
echo "[C] icon.ico 资源真实存在"
[ -f "$ICON_ICO" ] || { echo "FAIL: 缺 build/icon.ico"; exit 6; }
if command -v file >/dev/null 2>&1; then
  file "$ICON_ICO" | grep -qiE "icon" || { echo "FAIL: build/icon.ico 不是 Windows icon 格式"; exit 6; }
fi
# pkg assets 必须把 icon.ico 也打进虚拟 FS（保证可被引用 / 与 tray-icon 一致基线）
node -e "const a=(require('$PKG_JSON').pkg||{}).assets||[];process.exit(a.some(x=>/icon\.ico/.test(x))?0:1)" \
  || { echo "FAIL: pkg.assets 未含 build/icon.ico"; exit 6; }
echo "  OK: icon.ico 存在且打进 pkg.assets"

# ── D) 托盘兜底非纯透明 ────────────────────────────────────────────────────────────────
echo "[D] 托盘图标兜底非 1x1 透明（空白）"
# 旧的 1x1 透明兜底常量（一段固定 base64）必须已删除
if grep -q "WjzIeAAAAABJRU5ErkJggg==" "$TRAY_TS"; then
  echo "FAIL: tray.ts 仍用 1x1 透明 PNG 兜底（用户会看到空白托盘）"
  exit 5
fi
# 必须有一个内嵌的悦升云端兜底常量（命名约定 + 非空 base64）
grep -qE "FALLBACK_TRAY_ICON_BASE64|悦升云端" "$TRAY_TS" \
  || { echo "FAIL: tray.ts 缺内嵌的悦升云端兜底图标常量"; exit 5; }
echo "  OK: 托盘兜底为悦升云端占位"

# ── E) 模块三版本面一致（防误漂移；本 sprint 不动 line04 模块版本）───────────────────────
echo "[E] line04 三版本面一致校验"
V_MOD=$(node -e "process.stdout.write(require('$AGENT_DIR/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('$AGENT_DIR/build-modules/line04/manifest.json').version)")
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" \
       "$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "  modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
if [ "$V_MOD" != "$V_BUILD" ] || [ "$V_MOD" != "$V_HB" ]; then
  echo "FAIL: line04 三版本面不一致"
  exit 7
fi

echo "agent-form-smoke: ALL PASS"
