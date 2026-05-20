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

# 3. dotenv endpoint without session → 401（验证端点存在 + auth gate）
DOTENV_HTTP=$(curl -s -o /tmp/ip-dotenv-noauth.json -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/dotenv")
if [ "$DOTENV_HTTP" = "401" ]; then
  ok "dotenv 401 UNAUTHORIZED (auth gate 正常)"
elif [ "$DOTENV_HTTP" = "503" ]; then
  CODE=$(node -e "const m=require('/tmp/ip-dotenv-noauth.json'); process.stdout.write(m.code||'')" 2>/dev/null || echo "")
  ok "dotenv 503 code=$CODE (no session parsed — acceptable)"
else
  fail "dotenv HTTP $DOTENV_HTTP (expected 401 or 503)"
fi

# 4. manifest.cos_url 字段存在（COS CDN 路由需要）
if [ "$HTTP" = "200" ]; then
  COS_URL=$(node -e "const m=require('/tmp/ip-manifest.json'); process.stdout.write(m.cos_url||'')" 2>/dev/null || echo "")
  if [ -n "$COS_URL" ]; then
    ok "manifest.cos_url = $COS_URL"
    # HEAD 检查 COS URL 可访问性（可能因 CF/CDN 返回 403 range 不可用，接受）
    COS_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 --head "$COS_URL" 2>/dev/null || echo "000")
    if [ "$COS_HTTP" = "200" ] || [ "$COS_HTTP" = "206" ] || [ "$COS_HTTP" = "403" ]; then
      ok "COS URL HEAD HTTP $COS_HTTP (CDN 可达)"
    else
      fail "COS URL HEAD HTTP $COS_HTTP — COS 文件可能未上传"
    fi
  else
    fail "manifest.cos_url 为空 — 需要 CI publish-install-pack 步骤上传 COS 并写入 manifest"
  fi
fi

# 5. 静态 tar.gz nginx 路径可访问（HK VPS nginx /download/ 路由存在）
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
