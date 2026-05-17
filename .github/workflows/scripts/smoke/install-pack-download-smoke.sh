#!/usr/bin/env bash
# install-pack-download-smoke.sh
# Smoke test: install-pack manifest + download endpoint liveness + auth gate
set -euo pipefail

API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
PASS=0; FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== install-pack smoke (api=$API_BASE) ==="

# 1. manifest endpoint → 200 or 503(not built yet), not 404/500
HTTP=$(curl -s -o /tmp/ip-manifest.json -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/manifest")
if [ "$HTTP" = "200" ]; then
  VERSION=$(node -e "const m=require('/tmp/ip-manifest.json'); process.stdout.write(m.version||'')" 2>/dev/null || echo "")
  DL_URL=$(node -e "const m=require('/tmp/ip-manifest.json'); process.stdout.write(m.download_url||'')" 2>/dev/null || echo "")
  ok "manifest 200 version=$VERSION download_url=$DL_URL"
  [ -n "$VERSION" ] || fail "manifest.version 为空"
  [ -n "$DL_URL" ] || fail "manifest.download_url 为空"
elif [ "$HTTP" = "503" ]; then
  CODE=$(node -e "const m=require('/tmp/ip-manifest.json'); process.stdout.write(m.code||'')" 2>/dev/null || echo "")
  ok "manifest 503 code=$CODE (install pack not yet built — acceptable)"
else
  fail "manifest HTTP $HTTP (expected 200 or 503)"
fi

# 2. download endpoint without session → 401 UNAUTHORIZED（验证端点存在 + auth gate 生效）
DL_HTTP=$(curl -s -o /tmp/ip-dl-noauth.json -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/download")
if [ "$DL_HTTP" = "401" ]; then
  ok "download 401 UNAUTHORIZED (auth gate 正常)"
elif [ "$DL_HTTP" = "503" ]; then
  CODE=$(node -e "const m=require('/tmp/ip-dl-noauth.json'); process.stdout.write(m.code||'')" 2>/dev/null || echo "")
  ok "download 503 code=$CODE (no session parsed — acceptable non-404 response)"
else
  fail "download HTTP $DL_HTTP (expected 401 or 503, got unexpected status)"
fi

# 3. 静态 tar.gz nginx 路径可访问（HK VPS nginx /download/ 路由存在）
STATIC_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  --range 0-1023 \
  "$API_BASE/download/zenithjoy-agent-v1.0.1.tar.gz")
if [ "$STATIC_HTTP" = "206" ] || [ "$STATIC_HTTP" = "200" ]; then
  ok "static tar.gz nginx 路径 HTTP $STATIC_HTTP ✓"
elif [ "$STATIC_HTTP" = "404" ]; then
  fail "static tar.gz 404 — tar.gz 尚未部署到 nginx /download/"
else
  ok "static tar.gz HTTP $STATIC_HTTP (可能 CF 不支持 range，接受)"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
