#!/usr/bin/env bash
# wechat-rpa-real-agent-smoke.sh — Agent v1.1.77 wechat-rpa 真实脚本接入验证
#
# dist/ 是 gitignore 构建产物（COS install-pack 打包时重建，不入 git），
# 因此本 smoke 先 build 出 dist 再做静态校验，证明编译产物含真实接线。
#
# 验证（CI Linux 环境可跑）：
#   0. 前置目录/文件存在性（services/agent + wechat-rpa + package.json）
#   1. 真实 wechat-rpa Python 脚本存在（send_chat/qr_bind/send_moment/listen_chat）
#   2. 现场重建 dist（npm ci 锁版本 + npm run build，失败打印日志不静默吞错）
#   3. dist/handlers/wechat-rpa.js 含 send_chat.py / qr_bind.py / send_moment.py 路径映射
#   4. dist/handlers/wechat-rpa.js 含 REAL_PUBLISH 环境变量注入
#   5. dist/handlers/wechat-rpa.js 含 startWechatListener 导出 + win32 平台判断
#   6. dist/index.js 启动时调用 startWechatListener
#   7. Agent 版本号 == 1.1.77

set -euo pipefail

AGENT_DIR="services/agent"
RPA_DIR="$AGENT_DIR/wechat-rpa"
DIST="$AGENT_DIR/dist/handlers/wechat-rpa.js"
DIST_INDEX="$AGENT_DIR/dist/index.js"
PKG="$AGENT_DIR/package.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  wechat-rpa-real-agent smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[0] 前置目录存在性检查"
[ -d "$AGENT_DIR" ] || { echo "FAIL: $AGENT_DIR 不存在（请在 repo 根目录运行）"; exit 1; }
[ -d "$RPA_DIR" ]   || { echo "FAIL: $RPA_DIR 不存在"; exit 1; }
[ -f "$PKG" ]       || { echo "FAIL: $PKG 不存在"; exit 1; }
echo "  ✅ PASS (services/agent + wechat-rpa + package.json 齐全)"

echo "[1] 真实 wechat-rpa Python 脚本存在"
for f in send_chat.py qr_bind.py send_moment.py listen_chat.py; do
  [ -f "$RPA_DIR/$f" ] || { echo "FAIL: $RPA_DIR/$f 缺失"; exit 1; }
done
echo "  ✅ PASS (send_chat/qr_bind/send_moment/listen_chat 齐全)"

echo "[2] 构建 Agent dist（dist 为 gitignore 产物，CI 现场重建）"
# 依赖安装优先 npm ci（按 package-lock.json 锁定版本，可复现）；
# 缺锁文件时回退 npm install。构建/安装错误写入日志，失败时打印便于排查（不静默吞错）。
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! (
  cd "$AGENT_DIR"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  npm run build
) >"$BUILD_LOG" 2>&1; then
  echo "FAIL: 依赖安装或构建失败，日志如下："
  tail -40 "$BUILD_LOG"
  exit 1
fi
[ -f "$DIST" ] || { echo "FAIL: build 后 $DIST 不存在"; exit 1; }
echo "  ✅ PASS (dist 编译成功)"

echo "[3] dist 含 send_chat.py / qr_bind.py / send_moment.py 路径映射"
for kw in send_chat.py qr_bind.py send_moment.py; do
  grep -q "$kw" "$DIST" || { echo "FAIL: $kw 未在 dist 找到"; exit 1; }
done
echo "  ✅ PASS"

echo "[4] dist 含 REAL_PUBLISH 注入"
grep -q "REAL_PUBLISH" "$DIST" || { echo "FAIL: REAL_PUBLISH 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[5] dist 含 startWechatListener 导出 + win32 平台判断"
grep -q "startWechatListener" "$DIST" || { echo "FAIL: startWechatListener 未找到"; exit 1; }
grep -q "win32" "$DIST" || { echo "FAIL: win32 判断未找到"; exit 1; }
echo "  ✅ PASS"

echo "[6] dist/index.js 启动时调用 startWechatListener"
grep -q "startWechatListener" "$DIST_INDEX" || { echo "FAIL: index.js 未调用 startWechatListener"; exit 1; }
echo "  ✅ PASS"

echo "[7] Agent 版本 == 1.1.77"
VERSION=$(node -p "require('./$PKG').version")
[ "$VERSION" = "1.1.77" ] || { echo "FAIL: 版本 $VERSION != 1.1.77"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ ALL 7 checks PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
