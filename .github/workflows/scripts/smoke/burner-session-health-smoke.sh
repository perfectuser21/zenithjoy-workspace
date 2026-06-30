#!/usr/bin/env bash
# burner-session-health-smoke.sh
# 验证 POST /api/agent/burner/sessions/invalidate 端点存在且行为正确
# regression(2026-06-30): Douyin session 过期自动标记 needs_rebind

set -euo pipefail

BASE_URL="${SMOKE_API_BASE:-http://localhost:3000}"
echo "[smoke] burner-session-health: BASE_URL=$BASE_URL"

# ── 1. 缺 agent 上下文时返回 401 ──────────────────────────────────
echo "[smoke] 1/2 缺 agent 上下文 → 期望 401"
RESP=$(curl -s -o /tmp/burner-invalidate-resp.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/agent/burner/sessions/invalidate" \
  -H "Content-Type: application/json" \
  -d '{"reason":"DOUYIN_SESSION_EXPIRED"}')

if [ "$RESP" != "401" ] && [ "$RESP" != "400" ]; then
  echo "[smoke] FAIL: 期望 401/400，实际 $RESP"
  cat /tmp/burner-invalidate-resp.json
  exit 1
fi
echo "[smoke] OK: 无 agent 上下文 → $RESP"

# ── 2. 路由存在（非 404）────────────────────────────────────────────
echo "[smoke] 2/2 路由可达（非 404）"
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/agent/burner/sessions/invalidate" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Id: smoke-test-agent" \
  -d '{"reason":"DOUYIN_SESSION_EXPIRED"}')

if [ "$STATUS_CODE" = "404" ]; then
  echo "[smoke] FAIL: 路由 /api/agent/burner/sessions/invalidate 不存在 (404)"
  exit 1
fi
echo "[smoke] OK: 路由存在 → $STATUS_CODE"

echo "[smoke] burner-session-health PASS"
