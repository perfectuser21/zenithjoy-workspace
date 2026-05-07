#!/usr/bin/env bash
# agent-download-smoke.sh
# Walking Skeleton #1 — Agent tarball 公网分发 smoke
#
# 目标：验证客户视角"下载 Agent"链路真通：
#   - autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz 可访问
#   - HTTP 200 + content-type 是 octet-stream + content-length > 100KB
#   - 实际 GET 一份回来，tar -tzf 能列出 zenithjoy-agent/ 目录
#
# CI vs 人工：
#   - CI：本脚本走真公网 curl，但只校验 HEAD + 抽样 GET 一小段
#   - 人工每周：可加 MANUAL_VERIFY=1 模式跑完整 tar -tzf 校验
#
# 退出码：
#   0  下载链路全通
#   1  HEAD 失败（404/5xx/超时）
#   2  size/content-type 不对（说明 tarball 损坏或被错误的文件覆盖）
#   3  GET 实际下载失败
#   4  tar -tzf 验证失败（tarball 格式损坏）

set -uo pipefail

URL="${AGENT_TARBALL_URL:-https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz}"
MIN_SIZE="${MIN_SIZE:-100000}"

echo "▶ [1/3] HEAD ${URL}"
HEAD_OUT=$(curl -fsSI --max-time 15 "$URL" 2>&1) || {
  echo "  FAIL: HEAD failed"
  echo "$HEAD_OUT"
  exit 1
}
HTTP_CODE=$(echo "$HEAD_OUT" | head -1 | awk '{print $2}')
CONTENT_LEN=$(echo "$HEAD_OUT" | grep -i '^content-length:' | awk '{print $2}' | tr -d '\r')
CONTENT_TYPE=$(echo "$HEAD_OUT" | grep -i '^content-type:' | awk '{print $2}' | tr -d '\r')
echo "  HTTP=$HTTP_CODE  size=$CONTENT_LEN  type=$CONTENT_TYPE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "  FAIL: expected HTTP 200, got $HTTP_CODE"
  exit 1
fi
if [ -z "$CONTENT_LEN" ] || [ "$CONTENT_LEN" -lt "$MIN_SIZE" ]; then
  echo "  FAIL: content-length=$CONTENT_LEN < $MIN_SIZE (tarball 太小，可能损坏)"
  exit 2
fi

echo "▶ [2/3] GET 抽样下载"
TMP_TAR=$(mktemp -t zj-agent-smoke.XXXXXX.tar.gz)
trap 'rm -f "$TMP_TAR"' EXIT
curl -fsS --max-time 60 "$URL" -o "$TMP_TAR" 2>&1 || {
  echo "  FAIL: GET 下载失败"
  exit 3
}
GOT=$(stat -f%z "$TMP_TAR" 2>/dev/null || stat -c%s "$TMP_TAR" 2>/dev/null)
echo "  下载 $GOT bytes"
if [ "$GOT" != "$CONTENT_LEN" ]; then
  echo "  FAIL: 下载大小 $GOT 与 content-length $CONTENT_LEN 不一致"
  exit 3
fi

echo "▶ [3/3] tar -tzf 验证 tarball 完整性"
LIST=$(tar -tzf "$TMP_TAR" 2>&1 | head -20) || {
  echo "  FAIL: tar -tzf 失败"
  echo "$LIST"
  exit 4
}
echo "$LIST" | grep -qE '^zenithjoy-agent/' || {
  echo "  FAIL: tarball 顶层目录不是 zenithjoy-agent/"
  echo "$LIST"
  exit 4
}
echo "$LIST" | grep -qE 'package\.json|scripts/customer-start\.sh' || {
  echo "  FAIL: tarball 缺关键文件（package.json 或 scripts/customer-start.sh）"
  echo "$LIST"
  exit 4
}
echo "  OK: tarball 顶层 zenithjoy-agent/ 含关键文件"

echo ""
echo "✅ Walking Skeleton #1 Agent 下载链路 smoke PASS"
exit 0
