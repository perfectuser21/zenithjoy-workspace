#!/usr/bin/env bash
# Scratch API integration: real signup/session, authenticated metadata, APK bytes.
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:${API_PORT:-3001}}"
# This writes only disposable fixtures, never an inferred production identity.
[ "${SMOKE_SCRATCH_API:-}" = 1 ] || { echo 'FAIL: SMOKE_SCRATCH_API=1 required for isolated CI fixture writes'; exit 1; }
node - "$API_BASE" <<'JS'
const u=new URL(process.argv[2]);
if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('scratch smoke requires a loopback API');
JS

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail(){ echo "FAIL: $1"; exit 1; }
HTTP=$(curl -sS --max-time 15 -o "$TMP/unauth.json" -w '%{http_code}' "$API_BASE/api/agent/install-pack/android")
[ "$HTTP" = 401 ] || fail "无 session 期望 401，得 $HTTP"
jq -e '.code == "UNAUTHORIZED"' "$TMP/unauth.json" >/dev/null || fail '缺正确未登录错误码'

COOKIE_ARGS=()
if [ -n "${TEST_SESSION_COOKIE:-}" ]; then
  COOKIE_ARGS=(-H "Cookie: $TEST_SESSION_COOKIE")
else
  # The isolated CI database is disposable. Establish the same better-auth session
  # used by the customer; lack of a preseeded cookie must never skip this leg.
  EMAIL="onboarding-$(date +%s)-$$@example.com"
  PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(18).toString('hex'))")Aa1"
  PAYLOAD=$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password,name:"Onboarding Smoke"}')
  curl -fsS --max-time 20 -c "$TMP/cookies" -H 'Content-Type: application/json' \
    -d "$PAYLOAD" "$API_BASE/api/auth/sign-up/email" > "$TMP/signup.json"
  jq -e '.user.id | type == "string" and length > 0' "$TMP/signup.json" >/dev/null || fail '未建立真实用户会话'
  COOKIE_ARGS=(-b "$TMP/cookies")
fi
HTTP=$(curl -sS --max-time 20 -o "$TMP/install.json" -w '%{http_code}' "${COOKIE_ARGS[@]}" "$API_BASE/api/agent/install-pack/android")
[ "$HTTP" = 200 ] || fail "有 session 期望 200，得 $HTTP"
APK_URL=$(node - "$TMP/install.json" <<'JS'
const d=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
const url=new URL(d.apk_url), deep=new URL(d.deeplink);
if(!['http:','https:'].includes(url.protocol)||url.hostname.endsWith('.myqcloud.com')||url.pathname!='/install-pack/android/zenithjoy-agent.apk')throw Error('bad APK delivery URL');
if(deep.protocol!=='zenithjoy:'||deep.hostname!=='bind'||!deep.searchParams.get('api'))throw Error('bad bind deeplink');
if(typeof d.license_key!=='string'||(d.license_key?deep.searchParams.get('license')!==d.license_key:deep.searchParams.has('license')))throw Error('license/deeplink mismatch');
console.log(d.apk_url);
JS
) || fail '绑定metadata校验失败'
HTTP=$(curl -sS -L --max-time 20 -r 0-1023 -o "$TMP/apk" -w '%{http_code}' "$APK_URL")
case "$HTTP" in 200|206) ;; *) fail "APK 下载 HTTP $HTTP";; esac
node - "$TMP/apk" <<'JS'
const b=require('fs').readFileSync(process.argv[2]);
if(b.length<4||!b.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw Error('download is not APK/ZIP bytes');
JS
echo 'PASS: authenticated Android onboarding metadata and APK download'
