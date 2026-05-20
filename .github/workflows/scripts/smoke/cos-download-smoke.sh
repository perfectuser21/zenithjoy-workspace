#!/usr/bin/env bash
# cos-download-smoke.sh
# Smoke test: install-pack COS CDN 路由验证
#   1. manifest.cos_url 字段存在且非空
#   2. COS CDN URL HEAD 可访问（HTTP 200/206）
#   3. /dotenv 端点 auth gate（未登录 → 401）
set -euo pipefail

API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
PASS=0; FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== cos-download smoke (api=$API_BASE) ==="

# 1. manifest.cos_url 字段存在
HTTP=$(curl -s -o /tmp/cos-manifest.json -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/manifest")
if [ "$HTTP" != "200" ]; then
  fail "manifest HTTP $HTTP (expected 200)"
else
  COS_URL=$(node -e "const m=require('/tmp/cos-manifest.json'); process.stdout.write(m.cos_url||'')" 2>/dev/null || echo "")
  if [ -n "$COS_URL" ]; then
    ok "manifest.cos_url = $COS_URL"
  else
    fail "manifest.cos_url 为空 — CI 打包未写入 cos_url"
  fi

  # 2. COS CDN URL 可访问（range 前 1KB）
  if [ -n "$COS_URL" ]; then
    COS_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 --range 0-1023 "$COS_URL" 2>/dev/null || echo "000")
    if [ "$COS_HTTP" = "206" ] || [ "$COS_HTTP" = "200" ]; then
      ok "COS CDN HTTP $COS_HTTP (文件可下载)"
    else
      fail "COS CDN HTTP $COS_HTTP (expected 200/206) — 文件可能未上传"
    fi
  fi
fi

# 3. /dotenv 未登录 → 401（auth gate 生效）
DOTENV_HTTP=$(curl -s -o /tmp/cos-dotenv-noauth.json -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/dotenv")
if [ "$DOTENV_HTTP" = "401" ]; then
  ok "/dotenv 401 UNAUTHORIZED (auth gate 正常)"
elif [ "$DOTENV_HTTP" = "503" ]; then
  ok "/dotenv 503 (no session — acceptable)"
else
  fail "/dotenv HTTP $DOTENV_HTTP (expected 401)"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
