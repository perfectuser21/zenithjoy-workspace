#!/usr/bin/env bash
set -uo pipefail
API_PORT="${API_PORT:-3001}"; API_BASE="http://localhost:${API_PORT}"
ok(){ echo "✅ $1"; }; fail(){ echo "❌ $1"; exit 1; }
echo "── Android onboarding smoke ── $API_BASE"

# 1. 无 cookie → 401
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${API_BASE}/api/agent/install-pack/android")
[ "$HTTP" = "401" ] || fail "无 session 期望 401，得 $HTTP"
ok "无 session → 401"

# 2. 带 session（若测试环境提供 seeded TEST_SESSION_COOKIE 则校验 200；否则跳过并说明）
if [ -n "${TEST_SESSION_COOKIE:-}" ]; then
  TMP=$(mktemp)
  HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
    -H "Cookie: ${TEST_SESSION_COOKIE}" "${API_BASE}/api/agent/install-pack/android")
  [ "$HTTP" = "200" ] || { cat "$TMP"; fail "有 session 期望 200，得 $HTTP"; }
  APK_URL=$(node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));
    if(/\.myqcloud\.com\//.test(d.apk_url)){console.error('apk_url 落在 COS 默认域名，会被 DownloadForbidden 拦截:',d.apk_url);process.exit(1)}
    if(!/^https:\/\/.*\/install-pack\/android\/zenithjoy-agent\.apk$/.test(d.apk_url)){console.error('bad apk_url',d.apk_url);process.exit(1)}
    if(!d.deeplink.startsWith('zenithjoy://bind?')){console.error('bad deeplink',d.deeplink);process.exit(1)}
    console.log(d.apk_url)") || fail "schema 校验失败"
  rm -f "$TMP"; ok "有 session → 200 + apk_url(自定义域名) + deeplink"

  # 3. 环境接缝：真实向 apk_url 发请求，验证文件真的能下载（不是 COS DownloadForbidden 之类的拦截）
  #    这一步是本次 bug 的根因守卫——旧版本只校验了 URL 格式，从没真的 curl 过，
  #    导致 CI 全绿但真机点下载 100% 失败(DownloadForbidden)。
  APK_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -r 0-1023 "$APK_URL")
  case "$APK_HTTP" in
    200|206) ok "apk_url 真实下载可用（HTTP $APK_HTTP）" ;;
    *) fail "apk_url 真实下载失败，HTTP $APK_HTTP（可能是 COS DownloadForbidden 或自定义域名未生效）：$APK_URL" ;;
  esac
else
  echo "⏭️  未提供 TEST_SESSION_COOKIE，跳过 200 校验（CI 会注入）"
fi
echo "✅ android-onboarding smoke PASS"
