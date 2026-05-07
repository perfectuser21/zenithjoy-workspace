#!/usr/bin/env bash
# agent-onepush-smoke.sh
# Walking Skeleton #1 — install-and-start.bat 一键启动 smoke
#
# 目标：验证 agent tarball 包含 install-and-start.bat（thin 极限的 1-click）
#   - tarball 顶层（解压后 zenithjoy-agent/）含 install-and-start.bat
#   - 脚本含关键命令：npm install / set /p ZENITHJOY_LICENSE / scripts\customer-start.bat
#
# 退出码：
#   0  install-and-start.bat 齐 + 关键命令齐
#   1  tarball 下载失败
#   2  tarball 缺 install-and-start.bat
#   3  install-and-start.bat 缺关键命令

set -uo pipefail

BASE_URL="${AGENT_TARBALL_URL:-https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz}"
URL="${BASE_URL}?cb=$(date +%s)"

TMP_DIR=$(mktemp -d -t zj-onepush-smoke.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
TAR="$TMP_DIR/agent.tar.gz"

echo "▶ [1/3] 下载 tarball 从 $URL"
curl -fsS --max-time 60 "$URL" -o "$TAR" 2>&1 || {
  echo "  FAIL: 下载失败"
  exit 1
}
SIZE=$(stat -f%z "$TAR" 2>/dev/null || stat -c%s "$TAR" 2>/dev/null)
echo "  OK: $SIZE bytes"

echo "▶ [2/3] 解压并校验 install-and-start.bat 存在于 tarball 顶层"
tar -xzf "$TAR" -C "$TMP_DIR" || {
  echo "  FAIL: 解压失败"
  exit 1
}
BAT="$TMP_DIR/zenithjoy-agent/install-and-start.bat"
if [ ! -f "$BAT" ]; then
  echo "  FAIL: tarball 顶层缺 install-and-start.bat"
  ls -la "$TMP_DIR/zenithjoy-agent/" 2>&1 | head -10
  exit 2
fi
echo "  OK: $BAT 存在"

echo "▶ [3/3] 校验 install-and-start.bat 关键命令"
MISSING=()
grep -q "npm install" "$BAT" || MISSING+=("npm install")
grep -q "set /p ZENITHJOY_LICENSE" "$BAT" || MISSING+=("set /p ZENITHJOY_LICENSE 交互式提示")
grep -q "customer-start\.bat" "$BAT" || MISSING+=("调用 scripts\\customer-start.bat")
grep -q "node" "$BAT" || MISSING+=("Node.js 检查")

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "  FAIL: install-and-start.bat 缺关键命令："
  printf '    - %s\n' "${MISSING[@]}"
  exit 3
fi
echo "  OK: 含 npm install / set /p license / customer-start.bat 调用 / node 检查"

echo ""
echo "✅ Walking Skeleton #1 一键启动 smoke PASS（双击即跑）"
exit 0
