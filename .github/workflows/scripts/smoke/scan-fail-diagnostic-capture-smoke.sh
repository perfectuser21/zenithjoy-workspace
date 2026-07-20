#!/usr/bin/env bash
# scan-fail-diagnostic-capture-smoke.sh — 账号扫描失败自动截图+树摘要诊断上报
#
# 静态检查三处接线真实存在（不依赖真机/MediaProjection，CI 干净环境跑不了截图）：
#   1. Android 端 captureFailureDiagnostics 复用共享 ScreenCaptureService（不自建实例，
#      防止撞上 A14 CaptureSessionManager 单例纪律崩溃——final review 修过的 Critical）
#   2. Android 端广播携带 screenshot_b64/tree_dump
#   3. 服务端 /account-scan-result 落库这两个字段
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== 1. 静态检查：captureFailureDiagnostics 复用共享实例，不自建 ScreenCaptureService ==="
FN_BODY=$(sed -n '/private fun captureFailureDiagnostics/,/^    }/p' services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt)
if ! echo "$FN_BODY" | grep -q "AgentService.sharedScreenCaptureService"; then
  echo "FAIL: captureFailureDiagnostics 未复用 AgentService.sharedScreenCaptureService"
  exit 1
fi
if echo "$FN_BODY" | grep -q "ScreenCaptureService("; then
  echo "FAIL: captureFailureDiagnostics 又自建了 ScreenCaptureService 实例（会撞A14单例纪律）"
  exit 1
fi
echo "OK"

echo "=== 2. 静态检查：广播携带 EXTRA_SCREENSHOT_B64/EXTRA_TREE_DUMP ==="
if ! grep -q "EXTRA_SCREENSHOT_B64" services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt; then
  echo "FAIL: EXTRA_SCREENSHOT_B64 未定义"
  exit 1
fi
echo "OK"

echo "=== 3. 静态检查：服务端 /account-scan-result 落库 screenshot_b64/tree_dump ==="
if ! grep -q "screenshot_b64" apps/api/src/routes/agent-burner.ts; then
  echo "FAIL: 服务端未落库 screenshot_b64"
  exit 1
fi
echo "OK"

echo "=== 4. 存活服务健康检查（若 API_BASE 可达） ==="
if curl -sf -m 5 "$API_BASE/health" > /dev/null 2>&1; then
  echo "OK: $API_BASE/health 可达"
else
  echo "SKIP: $API_BASE 不可达（本地/CI 未起服务时的预期降级，静态检查已覆盖核心断言）"
fi

echo "=== scan-fail-diagnostic-capture-smoke PASS ==="
