#!/usr/bin/env bash
# machine-events-smoke.sh (ZenithJoy / Line02 机器观测面板)
# 验证机器详情「模块与日志」面板所依赖的读端点 GET /api/agent/machines/:id/events。
# 可对本地(默认)或 staging 跑：  BASE_URL=https://staging-autopilot.zenjoymedia.media bash machine-events-smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
TENANT="${TENANT:-smoke-tenant-events}"
AUTH=(-H "X-Tenant-Id: $TENANT")
echo "machine-events-smoke base: $BASE_URL tenant: $TENANT"

# 0) 回归守卫：无认证上下文（无 session 无 X-Tenant-Id）→ 必须 401（租户隔离）
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000/events")
echo "events(no-auth) -> HTTP $CODE"
[ "$CODE" = "401" ] || { echo "FAIL: 无认证 events 期望 401 got $CODE"; exit 1; }

# 1) 带租户查不存在的机器 events → 404（tenant 隔离 + 机器不存在）
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000/events")
echo "events(bogus machine) -> HTTP $CODE"
[ "$CODE" = "404" ] || { echo "FAIL: 不存在机器 events 期望 404 got $CODE"; exit 1; }

# 2) 端点存在性（不存在的路由会是 404 但带 {success:false}/HTML；这里确认 405 不出现、JSON 信封）
BODY=$(curl -s "${AUTH[@]}" "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000/events" || true)
echo "events(body) -> $BODY"
echo "$BODY" | node -e 'const s=require("fs").readFileSync(0,"utf8"); const d=JSON.parse(s); if(typeof d.success!=="boolean"){console.error("FAIL: 非 JSON 信封");process.exit(1)} console.log("OK: JSON 信封 success="+d.success)'

echo "PASS machine-events-smoke — 无认证401 + 不存在机器404 + JSON 信封"
