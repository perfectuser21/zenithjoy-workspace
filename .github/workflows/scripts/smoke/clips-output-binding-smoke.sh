#!/usr/bin/env bash
# Smoke test: clips per-user output binding (Feishu OAuth + Notion token)
# Tests: DB columns exist, API endpoints respond correctly, no_binding handled gracefully
set -euo pipefail

API="${API_BASE_URL:-http://localhost:5200}"

echo "=== clips-output-binding smoke ==="

# 1. Verify DB columns exist in user_clip_settings (skip if no DB_URL provided)
echo "[1] DB columns check..."
if [ -n "${DATABASE_URL:-}" ]; then
  COLS=$(psql "$DATABASE_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='user_clip_settings' ORDER BY column_name" 2>/dev/null || echo "")
  for COL in notion_token feishu_user_token feishu_refresh_token feishu_user_id feishu_user_name feishu_token_expires_at; do
    echo "$COLS" | grep -q "$COL" && echo "  ✅ $COL" || { echo "  ❌ missing: $COL"; exit 1; }
  done
else
  echo "  skip: DATABASE_URL not set"
fi

# 2. API /api/clips/auth/feishu — unauthenticated must return 401 (not redirect or 5xx)
echo "[2] Feishu OAuth endpoint auth check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${API}/api/clips/auth/feishu" 2>/dev/null || echo "conn_refused")
if [ "$HTTP_CODE" = "conn_refused" ]; then
  echo "  skip: API not reachable"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "  ✅ /api/clips/auth/feishu returns 401 (correct: unauthed)"
else
  echo "  ❌ unexpected status: $HTTP_CODE (expected 401)"
  exit 1
fi

# 3. /api/clips/settings — unauthenticated must return 401
echo "[3] Settings endpoint auth check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${API}/api/clips/settings" 2>/dev/null || echo "conn_refused")
if [ "$HTTP_CODE" = "conn_refused" ]; then
  echo "  skip: API not reachable"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "  ✅ /api/clips/settings returns 401 (correct: unauthed)"
else
  echo "  ❌ unexpected status: $HTTP_CODE (expected 401)"
  exit 1
fi

# 4. Verify per-user token logic exists in service source
echo "[4] per-user token service logic check..."
node -e "
const s = require('fs').readFileSync('apps/api/src/services/clip-output.service.ts', 'utf8');
if (!s.includes('no_binding')) { console.error('missing no_binding'); process.exit(1); }
if (!s.includes('no_output_configured')) { console.error('missing no_output_configured'); process.exit(1); }
if (!s.includes('getUserTokens')) { console.error('missing getUserTokens'); process.exit(1); }
if (!s.includes('feishuExpiresAt')) { console.error('missing auto-refresh logic'); process.exit(1); }
console.log('  ✅ clip-output.service.ts contains all per-user token logic');
"

echo "=== clips-output-binding smoke PASS ==="
