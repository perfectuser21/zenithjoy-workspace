#!/usr/bin/env bash
# wechat-rpa-real-agent-smoke.sh — Agent v1.1.77 wechat-rpa 真实脚本接入验证
#
# dist/ 是 gitignore 构建产物（COS install-pack 打包时重建，不入 git），
# 因此本 smoke 先 build 出 dist 再做静态校验，证明编译产物含真实接线。
#
# 验证（CI Linux 环境可跑）：
#   1. 真实 wechat-rpa Python 脚本存在（send_chat/qr_bind/send_moment/listen_chat）
#   2. dist/handlers/wechat-rpa.js 含 send_chat.py / qr_bind.py / send_moment.py 路径映射
#   3. dist/handlers/wechat-rpa.js 含 REAL_PUBLISH 环境变量注入
#   4. dist/handlers/wechat-rpa.js 含 startWechatListener 导出 + win32 平台判断
#   5. dist/index.js 启动时调用 startWechatListener
#   6. Agent 版本号 == 1.1.77

set -euo pipefail

AGENT_DIR="services/agent"
RPA_DIR="$AGENT_DIR/wechat-rpa"
DIST="$AGENT_DIR/dist/handlers/wechat-rpa.js"
DIST_INDEX="$AGENT_DIR/dist/index.js"
PKG="$AGENT_DIR/package.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  wechat-rpa-real-agent smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[1] 真实 wechat-rpa Python 脚本存在"
for f in send_chat.py qr_bind.py send_moment.py listen_chat.py; do
  [ -f "$RPA_DIR/$f" ] || { echo "FAIL: $RPA_DIR/$f 缺失"; exit 1; }
done
echo "  ✅ PASS (send_chat/qr_bind/send_moment/listen_chat 齐全)"

echo "[2] 构建 Agent dist（dist 为 gitignore 产物，CI 现场重建）"
( cd "$AGENT_DIR" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 )
( cd "$AGENT_DIR" && npm run build >/dev/null 2>&1 )
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
VERSION=$(node -e "console.log(require('./$PKG').version)")
[ "$VERSION" = "1.1.77" ] || { echo "FAIL: 版本 $VERSION != 1.1.77"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ ALL 7 checks PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
