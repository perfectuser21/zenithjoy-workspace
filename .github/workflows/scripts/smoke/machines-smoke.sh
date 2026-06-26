#!/usr/bin/env bash
# machines-smoke.sh (ZenithJoy / Line02 机器管理)
# 对运行中的 API 验证机器管理 3 端点的真实链路（结构 + 错误路径 + 租户隔离），不依赖 DB seed。
# 可对本地(默认)或 staging 跑：  BASE_URL=https://staging-autopilot.zenjoymedia.media bash machines-smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
# 已认证上下文：非浏览器 caller 用 X-Tenant-Id 头驱动租户（dashboard 走 better-auth session）
TENANT="${TENANT:-smoke-tenant-machines}"
AUTH=(-H "X-Tenant-Id: $TENANT")
echo "machines-smoke base: $BASE_URL  tenant: $TENANT"

# 0) 回归守卫：无任何认证上下文（无 session 无 X-Tenant-Id）→ 必须 401，绝不全表/空表糊弄
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/agent/machines")
echo "list(no-auth) -> HTTP $CODE"
[ "$CODE" = "401" ] || { echo "FAIL: 无认证机器列表 expected 401 got $CODE（租户隔离回归！）"; exit 1; }

# 1) GET 机器列表（带租户）：必须 {success:true, data:[...]}（该租户无机器 → 空数组也合法）
LIST=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/agent/machines")
echo "list -> $LIST"
echo "$LIST" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.success!==true||!Array.isArray(d.data)){console.error("FAIL: list shape");process.exit(1)} console.log("OK list: data is array len="+d.data.length)'

# 2) GET 不存在的机器详情：tenant 隔离 + 不存在都应 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000")
echo "detail(bogus) -> HTTP $CODE"
[ "$CODE" = "404" ] || { echo "FAIL: bogus detail expected 404 got $CODE"; exit 1; }

# 3) PUT 非法 machine_role：必须 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X PUT "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"machine_role":"banana"}')
echo "put(invalid role) -> HTTP $CODE"
[ "$CODE" = "400" ] || { echo "FAIL: invalid machine_role expected 400 got $CODE"; exit 1; }

# 4) PUT 不存在机器（合法字段）：必须 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X PUT "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"nickname":"x","machine_role":"sub"}')
echo "put(bogus id) -> HTTP $CODE"
[ "$CODE" = "404" ] || { echo "FAIL: bogus PUT expected 404 got $CODE"; exit 1; }

echo "PASS machines-smoke — 无认证401 + 3 端点结构 + 错误路径全通过"
