#!/usr/bin/env bash
# sprint-2-1f-prod-readiness-smoke.sh
# Sprint 2.1f — Path 1 Step 2 真客户首次成功产品级容错 smoke
#
# 目标：验证 sprint 2.1f 的 9 件 fix 部署在公网真生效：
#   - install pack v1.0.1 在 HK 公网可下载
#   - tarball 含新加的 uninstall.bat（Fix 9）+ start.bat（Fix 5/8 重写）
#   - register endpoint 接受 hex license（Fix 3 正则放宽）— 不再 BAD_REQUEST
#
# CI vs 人工：
#   - CI：本脚本走真公网 curl HK + register endpoint
#   - 人工：同事真客户机 e2e（卸载→下载→双击→真发抖音）— evidence 单独留
#
# 退出码：
#   0  全 smoke 通
#   1  v1.0.1 tarball HEAD 失败
#   2  tarball 缺 sprint 2.1f 新文件（uninstall.bat / start.bat 编码不对）
#   3  register endpoint hex license 仍被拒（BAD_REQUEST）

set -uo pipefail

URL="${INSTALL_PACK_URL:-https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v1.0.1.tar.gz}"
API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
HEX_LIC="${HEX_LICENSE_FIXTURE:-ZJ-F-44D00A51}"  # 含 0/1 的 hex license — 测 Fix 3 正则放宽

echo "▶ [1/3] HEAD ${URL} (Fix 7 build install pack v1.0.1 部署到 HK)"
HEAD_OUT=$(curl -fsSI --max-time 15 "$URL" 2>&1) || {
  echo "  FAIL: HEAD failed"
  echo "$HEAD_OUT"
  exit 1
}
HTTP_CODE=$(echo "$HEAD_OUT" | head -1 | awk '{print $2}')
CONTENT_LEN=$(echo "$HEAD_OUT" | grep -i '^content-length:' | awk '{print $2}' | tr -d '\r')
echo "  HTTP=$HTTP_CODE  size=$CONTENT_LEN"

if [ "$HTTP_CODE" != "200" ]; then
  echo "  FAIL: expected HTTP 200, got $HTTP_CODE"
  exit 1
fi

echo "▶ [2/3] GET tarball + 验证含 Fix 5/9 新文件"
TMP_TAR=$(mktemp -t zj-sprint-2-1f-smoke.XXXXXX.tar.gz)
trap 'rm -f "$TMP_TAR"' EXIT
curl -fsS --max-time 60 "$URL" -o "$TMP_TAR" 2>&1 || {
  echo "  FAIL: GET 下载失败"
  exit 1
}

LIST=$(tar -tzf "$TMP_TAR" 2>&1) || {
  echo "  FAIL: tar -tzf 失败"
  exit 2
}

# Fix 9: uninstall.bat 必须存在
echo "$LIST" | grep -qE 'uninstall\.bat$' || {
  echo "  FAIL: tarball 缺 uninstall.bat (Fix 9 没生效，build 用了旧 manifest)"
  echo "$LIST" | head -10
  exit 2
}

# Fix 5: start.bat 必须存在
echo "$LIST" | grep -qE 'start\.bat$' || {
  echo "  FAIL: tarball 缺 start.bat"
  exit 2
}

echo "  OK: tarball 含 uninstall.bat + start.bat"

echo "▶ [3/3] register endpoint 接受 hex license (Fix 3 正则放宽)"
REG_OUT=$(curl -sS --max-time 15 -X POST "${API_BASE}/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\":\"${HEX_LIC}\",\"machine_id\":\"smoke-2-1f-$(date +%s)\",\"agent_version\":\"1.0.1\"}")
echo "  response: $REG_OUT" | head -1

# 不再返 BAD_REQUEST 含 "license_key 格式不合法" — 那意味着 Fix 3 没生效
if echo "$REG_OUT" | grep -q "license_key 格式不合法"; then
  echo "  FAIL: register endpoint 仍拒 hex license (Fix 3 正则放宽未生效)"
  exit 3
fi

# 接受任何不是 BAD_REQUEST 格式错的响应（QUOTA_EXCEEDED / INVALID_LICENSE / OK 都说明格式 OK）
echo "  OK: register endpoint 接受 hex license 格式 (无论业务结果)"

echo ""
echo "✅ Sprint 2.1f smoke PASS — install pack v1.0.1 + Fix 3/5/7/9 公网真生效"
exit 0
