#!/usr/bin/env bash
# machines-smoke.sh (ZenithJoy / Line02 机器管理)
# 对运行中的 API 验证机器管理 3 端点的真实链路（结构 + 错误路径），不依赖 DB seed。
# 可对本地(默认)或 staging 跑：  BASE_URL=https://staging-autopilot.zenjoymedia.media bash machines-smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
echo "machines-smoke base: $BASE_URL"

# 1) GET 机器列表：必须返回 {success:true, data:[...]}（无 tenant → 空数组也合法）
LIST=$(curl -fsS "$BASE_URL/api/agent/machines")
echo "list -> $LIST"
echo "$LIST" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.success!==true||!Array.isArray(d.data)){console.error("FAIL: list shape");process.exit(1)} console.log("OK list: data is array len="+d.data.length)'

# 2) GET 不存在的机器详情：tenant 隔离 + 不存在都应 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000")
echo "detail(bogus) -> HTTP $CODE"
[ "$CODE" = "404" ] || { echo "FAIL: bogus detail expected 404 got $CODE"; exit 1; }

# 3) PUT 非法 machine_role：必须 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"machine_role":"banana"}')
echo "put(invalid role) -> HTTP $CODE"
[ "$CODE" = "400" ] || { echo "FAIL: invalid machine_role expected 400 got $CODE"; exit 1; }

# 4) PUT 不存在机器（合法字段）：必须 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"nickname":"x","machine_role":"sub"}')
echo "put(bogus id) -> HTTP $CODE"
[ "$CODE" = "404" ] || { echo "FAIL: bogus PUT expected 404 got $CODE"; exit 1; }

echo "PASS machines-smoke — 3 端点结构 + 错误路径全通过"
