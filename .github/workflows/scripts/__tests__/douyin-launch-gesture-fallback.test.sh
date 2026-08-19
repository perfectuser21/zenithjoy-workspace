#!/usr/bin/env bash
# 守卫：拉起抖音必须有「手势点击桌面图标」兜底，且 startActivity 的静默拦截不得当成成功。
#
# 真机实证（2026-08-19，小白 realme RMX3478/ColorOS/安卓14）：
#   agent MainActivity 在前台             ✅（agent 已有前台身份）
#   adb shell am start 拉抖音 → 成功       ✅（抖音本身没问题，前台变 aweme/.splash.SplashActivity）
#   agent 内 startActivity 拉抖音 → 失败   ❌ startCollect: 抖音到前台=false / WRONG_FOREGROUND
# ColorOS 拦截 app 发起的 Activity 启动：adb 走 shell 权限不受限，app 受限。
#
# 致命之处在于【静默】：startActivity 不抛异常，launchDouyin() 的 try/catch 抓不到，
# 直接 return true，调用方以为拉起成功，一路走到 openSearchBar 等 12 秒再报 NO_SEARCH_INPUT，
# 错误码指向搜索框，真凶却是拉起——排查被误导。
#
# 荣耀侧已有先例：为绕 iAware 加了透明 trampoline（PR #1637，3/3）。ColorOS 需要一条
# 平行路径。最保险的形态是【无障碍手势点击桌面图标】——完全模拟真人，任何 ROM 的
# 后台启动限制都拦不住（无障碍服务本就是为替用户操作而生）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }

# 1. 必须存在手势兜底路径
if grep -qE 'fun launchDouyinByGesture|launchDouyinByGesture\(' "$SRC"; then
  ok "存在手势点击桌面图标的兜底路径"
else
  bad "无手势兜底 —— ColorOS 静默拦截 startActivity 时无路可走（小白真机实证）"
fi

# 2. 前台验证失败后必须真的走兜底，不能只记日志
BODY=$(awk '/private fun startCollect|fun startCollect\(/{f=1} f{print} f&&/^    \}$/{exit}' "$SRC")
if grep -qE 'launchDouyinByGesture' <<< "$BODY"; then
  ok "抖音未到前台时触发手势兜底"
else
  bad "抖音未到前台仅记日志继续走 —— 会一路错到 NO_SEARCH_INPUT，错误码指向搜索框掩盖真凶"
fi

# 3. 手势兜底必须用 dispatchGesture（真手势），不得又回到 startActivity
GBODY=$(awk '/fun launchDouyinByGesture/{f=1} f{print} f&&/^    \}$/{exit}' "$SRC")
# tapNodeCenter 内部就是 dispatchGesture（复用既有手势件，不重复代码）
if [ -n "$GBODY" ] && grep -qE 'dispatchGesture|tapNodeCenter' <<< "$GBODY"; then
  ok "兜底走真手势(dispatchGesture / tapNodeCenter)"
elif [ -z "$GBODY" ]; then
  bad "手势兜底函数体为空/不存在"
else
  bad "兜底未用真手势 —— 再用 startActivity 会被同样拦截"
fi

# 4. 兜底结果必须可观测（成功/失败都留痕）
if grep -qE 'Log\.(i|w)\(.*(手势|gesture)' "$SRC"; then
  ok "手势兜底结果有日志"
else
  bad "手势兜底无日志 —— 又是一个静默路径"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
