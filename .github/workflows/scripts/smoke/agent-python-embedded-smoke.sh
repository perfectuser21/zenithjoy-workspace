#!/usr/bin/env bash
# agent-python-embedded-smoke.sh — Agent v1.1.78 内置 Python embedded + wechat-rpa 零依赖安装验证
#
# 目标：证明安装包从「客户需手动装 Python」升级到「解压即用」（Path 4 Step 1 thin→medium）。
# dist/ 是 gitignore 构建产物（COS install-pack 打包时重建，不入 git），
# 因此本 smoke 先 build 出 dist 再做静态校验，证明编译产物含 embedded Python 接线。
#
# 验证（CI Linux 环境可跑，无需真 Windows / 真微信）：
#   1. wechat-rpa.ts 源码含 getPythonExeForTest 导出 + python-embedded/python.exe 路径
#   2. 构建 dist，dist/handlers/wechat-rpa.js 含 python-embedded 路径（不再硬编码 python3）
#   3. dist 含 getPythonExeForTest 导出（可注入 baseDir 的纯函数）
#   4. start.bat 含讲述人（Narrator）解锁微信 UIAutomation 命令
#   5. build-install-pack.sh 含 Python embeddable 下载 + python-embedded/ 组装
#   6. build-install-pack.sh 含 wechat-rpa/ 脚本拷贝进安装包
#   7. wechat-rpa/ 真实 Python 脚本齐全（send_chat/qr_bind/send_moment/listen_chat）
#   8. Agent 版本号 == 1.1.78
#   9. 单测通过（含 getPythonExeForTest 目录不存在回退 python3）

set -euo pipefail

AGENT_DIR="services/agent"
SRC="$AGENT_DIR/src/handlers/wechat-rpa.ts"
DIST="$AGENT_DIR/dist/handlers/wechat-rpa.js"
BAT="$AGENT_DIR/install-pack/start.bat"
BUILD_SH="$AGENT_DIR/scripts/build-install-pack.sh"
RPA_DIR="$AGENT_DIR/wechat-rpa"
PKG="$AGENT_DIR/package.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  agent-python-embedded smoke (v1.1.78)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[1] 源码 wechat-rpa.ts 含 getPythonExeForTest + python-embedded 路径"
grep -q "getPythonExeForTest" "$SRC" || { echo "FAIL: getPythonExeForTest 未在源码"; exit 1; }
grep -q "python-embedded" "$SRC" || { echo "FAIL: python-embedded 路径未在源码"; exit 1; }
echo "  ✅ PASS"

echo "[2] 构建 Agent dist（dist 为 gitignore 产物，CI 现场重建）"
( cd "$AGENT_DIR" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 )
( cd "$AGENT_DIR" && npm run build >/dev/null 2>&1 )
[ -f "$DIST" ] || { echo "FAIL: build 后 $DIST 不存在"; exit 1; }
grep -q "python-embedded" "$DIST" || { echo "FAIL: dist 未含 python-embedded 路径"; exit 1; }
echo "  ✅ PASS (dist 编译含 embedded Python 路径)"

echo "[3] dist 含 getPythonExeForTest 导出"
grep -q "getPythonExeForTest" "$DIST" || { echo "FAIL: dist 未含 getPythonExeForTest"; exit 1; }
echo "  ✅ PASS"

echo "[4] start.bat 含讲述人（Narrator）解锁命令"
grep -q "Narrator" "$BAT" || { echo "FAIL: start.bat 缺 Narrator 解锁"; exit 1; }
echo "  ✅ PASS"

echo "[5] build-install-pack.sh 含 Python embeddable 下载 + python-embedded/ 组装"
grep -q "embed-amd64" "$BUILD_SH" || { echo "FAIL: 缺 Python embeddable 下载"; exit 1; }
grep -q "python-embedded" "$BUILD_SH" || { echo "FAIL: 缺 python-embedded 组装"; exit 1; }
echo "  ✅ PASS"

echo "[6] build-install-pack.sh 含 wechat-rpa/ 脚本拷贝"
grep -q "wechat-rpa" "$BUILD_SH" || { echo "FAIL: 缺 wechat-rpa/ 拷贝"; exit 1; }
echo "  ✅ PASS"

echo "[7] wechat-rpa/ 真实 Python 脚本齐全"
for f in send_chat.py qr_bind.py send_moment.py listen_chat.py; do
  [ -f "$RPA_DIR/$f" ] || { echo "FAIL: $RPA_DIR/$f 缺失"; exit 1; }
done
echo "  ✅ PASS"

echo "[8] Agent 版本 == 1.1.78"
VERSION=$(node -e "console.log(require('./$PKG').version)")
[ "$VERSION" = "1.1.78" ] || { echo "FAIL: 版本 $VERSION != 1.1.78"; exit 1; }
echo "  ✅ PASS"

echo "[9] 单测通过（含 getPythonExeForTest 回退 python3）"
( cd "$AGENT_DIR" && npx vitest run src/handlers/__tests__/wechat-rpa.test.ts >/dev/null 2>&1 ) || { echo "FAIL: 单测未通过"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ ALL 9 checks PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
