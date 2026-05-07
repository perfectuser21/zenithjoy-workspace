#!/usr/bin/env bash
# agent-windows-quickstart-smoke.sh
# Walking Skeleton #1 — Windows 客户启动支持 smoke
#
# 目标：验证 agent tarball 包含 Windows 客户启动所需文件 + 关键命令
#   - tarball 含 scripts/customer-start.bat
#   - .bat 含 chrome.exe 探测 + npm start + ZENITHJOY_LICENSE 校验
#   - tarball 也保留 macOS 路径 scripts/customer-start.sh（开发者备用）
#
# 退出码：
#   0  Windows + macOS 双路径都齐
#   1  下载 tarball 失败
#   2  tarball 里缺 customer-start.bat
#   3  customer-start.bat 缺关键命令
#   4  tarball 里缺 customer-start.sh（macOS 备用）

set -uo pipefail

BASE_URL="${AGENT_TARBALL_URL:-https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz}"
# 加 cache-buster 避免 Cloudflare 缓存
URL="${BASE_URL}?cb=$(date +%s)"

TMP_DIR=$(mktemp -d -t zj-windows-smoke.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
TAR="$TMP_DIR/agent.tar.gz"

echo "▶ [1/3] 下载 tarball 从 $URL"
curl -fsS --max-time 60 "$URL" -o "$TAR" 2>&1 || {
  echo "  FAIL: 下载失败"
  exit 1
}
SIZE=$(stat -f%z "$TAR" 2>/dev/null || stat -c%s "$TAR" 2>/dev/null)
echo "  OK: $SIZE bytes"

echo "▶ [2/3] 解压并校验 Windows .bat 脚本"
tar -xzf "$TAR" -C "$TMP_DIR" || {
  echo "  FAIL: 解压失败"
  exit 1
}
BAT="$TMP_DIR/zenithjoy-agent/scripts/customer-start.bat"
if [ ! -f "$BAT" ]; then
  echo "  FAIL: tarball 缺 scripts/customer-start.bat"
  ls -la "$TMP_DIR/zenithjoy-agent/scripts/" 2>&1 | head -5
  exit 2
fi
echo "  OK: $BAT 存在"

# 关键命令检查
MISSING=()
grep -q "chrome.exe" "$BAT" || MISSING+=("chrome.exe 探测")
grep -q "ZENITHJOY_LICENSE" "$BAT" || MISSING+=("ZENITHJOY_LICENSE 校验")
grep -q "npm start" "$BAT" || MISSING+=("npm start 调用")
grep -q "remote-debugging-port" "$BAT" || MISSING+=("Chrome 调试端口")

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "  FAIL: customer-start.bat 缺关键内容："
  printf '    - %s\n' "${MISSING[@]}"
  exit 3
fi
echo "  OK: customer-start.bat 含 chrome.exe / ZENITHJOY_LICENSE / npm start / 调试端口"

echo "▶ [3/3] 校验 macOS 备用 .sh 脚本仍存在"
SH="$TMP_DIR/zenithjoy-agent/scripts/customer-start.sh"
if [ ! -f "$SH" ]; then
  echo "  FAIL: tarball 缺 scripts/customer-start.sh（macOS 备用路径不能丢）"
  exit 4
fi
echo "  OK: macOS customer-start.sh 仍在"

echo ""
echo "✅ Walking Skeleton #1 Windows 客户启动支持 smoke PASS（双平台 OK）"
exit 0
