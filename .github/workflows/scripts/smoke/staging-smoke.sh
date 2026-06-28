#!/usr/bin/env bash
# staging-smoke.sh — ZenithJoy staging dashboard 冒烟验证
# 用法: bash .github/workflows/scripts/smoke/staging-smoke.sh [STAGING_URL]
set -euo pipefail

STAGING_URL="${1:-https://staging-autopilot.zenjoymedia.media}"
MAX_WAIT=60
INTERVAL=5
elapsed=0

echo "=== Staging Smoke: $STAGING_URL ==="

# 等待 staging 健康
until curl -sf "$STAGING_URL" --max-time 10 -o /tmp/staging-body.html > /dev/null 2>&1; do
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "❌ staging 在 ${MAX_WAIT}s 内未就绪: $STAGING_URL"
    exit 1
  fi
  echo "  等待 staging... (${elapsed}s)"
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done

# 验证返回内容是 HTML（不是错误页）
if ! grep -qi "<html" /tmp/staging-body.html; then
  echo "❌ staging 响应不含 HTML: $STAGING_URL"
  cat /tmp/staging-body.html | head -5
  exit 1
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STAGING_URL")
echo "✅ staging smoke 通过: $STAGING_URL (HTTP $HTTP_CODE)"
