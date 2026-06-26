#!/usr/bin/env bash
# acquisition-config-ui-smoke.sh (ZenithJoy / Line02 获客配置页所依赖的端点)
# 验证「获客配置页 / 分析+指派」面板依赖的读端点（config / dispatch plan / cookie-health）。
# 可对本地(默认)或 staging 跑：  BASE_URL=https://staging-autopilot.zenjoymedia.media bash acquisition-config-ui-smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
TENANT="${TENANT:-smoke-tenant-acq}"
AUTH=(-H "X-Tenant-Id: $TENANT")
echo "acquisition-config-ui-smoke base: $BASE_URL tenant: $TENANT"

# 0) 回归守卫：无认证上下文 → config 必须 401（租户隔离，绝不裸读别人配置）
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/acquisition/config")
echo "config(no-auth) -> HTTP $CODE"
[ "$CODE" = "401" ] || { echo "FAIL: 无认证 config 期望 401 got $CODE"; exit 1; }

# 1) 带租户读 config → 200 + JSON 信封（无配置则返默认）
BODY=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/acquisition/config")
echo "config -> $BODY"
echo "$BODY" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.success!==true){console.error("FAIL: config 信封");process.exit(1)} const c=d.data||{}; if(typeof c.dm_per_hour!=="number"){console.error("FAIL: 缺 dm_per_hour 默认");process.exit(1)} console.log("OK config: dm_per_hour="+c.dm_per_hour+" burner_count="+c.burner_count)'

# 2) 指派计划 + cookie 健康端点存在性（带租户，JSON 信封）
for ep in "dispatch/plan" "cookie-health"; do
  B=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/acquisition/$ep" || true)
  echo "$ep -> $B"
  echo "$B" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(typeof d.success!=="boolean"){console.error("FAIL: 非 JSON 信封");process.exit(1)} console.log("OK 信封")'
done

echo "PASS acquisition-config-ui-smoke — 无认证401 + config默认 + plan/cookie-health 信封"
