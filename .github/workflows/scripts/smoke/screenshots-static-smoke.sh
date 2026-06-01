#!/usr/bin/env bash
# screenshots-static-smoke.sh
# Smoke test: /screenshots 静态文件服务端点可访问
# 验证 express.static 中间件在 /screenshots 路由上正确挂载
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"

echo "=== Screenshots Static Smoke ==="
echo "Target: $API_BASE/screenshots/"

# 1. 上传测试文件到本地目录（模拟 E2E 截图）
SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/opt/zenithjoy/screenshots}"
mkdir -p "$SCREENSHOTS_DIR"
TEST_FILE="$SCREENSHOTS_DIR/smoke-test.txt"
echo "smoke-test-$(date +%s)" > "$TEST_FILE"
echo "[1/3] 写入测试文件: $TEST_FILE"

# 2. 请求 /screenshots/smoke-test.txt，验证返回 200
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/screenshots/smoke-test.txt")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: /screenshots/smoke-test.txt 返回 $HTTP_CODE，期望 200"
  exit 1
fi
echo "[2/3] GET /screenshots/smoke-test.txt => $HTTP_CODE OK"

# 3. 请求不存在的文件，验证返回 404
HTTP_CODE_404=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/screenshots/nonexistent-file.txt")
if [ "$HTTP_CODE_404" != "404" ]; then
  echo "FAIL: 不存在的文件返回 $HTTP_CODE_404，期望 404"
  exit 1
fi
echo "[3/3] GET /screenshots/nonexistent-file.txt => $HTTP_CODE_404 OK"

# 清理
rm -f "$TEST_FILE"

echo "=== Screenshots Static Smoke PASSED ==="
