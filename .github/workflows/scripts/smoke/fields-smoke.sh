#!/usr/bin/env bash
# fields-smoke.sh — CRM 自定义字段管理 smoke（crm_field_management）
# 验证：list / create / update / delete 完整 CRUD
#
# G1 / J7 段②（本刀同步改动）：/api/fields 四端点从"无任何鉴权"改成挂 works 家族的租户闸。
# 原来那个 X-Internal-Token 从此换不到身份，四步会全部被打成 401 —— 这不是回归，是这道闸
# 生效的证据。脚本改成**自己种一个租户 + 成员**，再用那个成员的身份调，
# 顺带把"隔离生效后正常用户还能不能用"也测掉（PR#1675→#1676 那次往返就是漏了这一半）。
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }
die()  { echo "❌ FAIL: $*"; exit 1; }

PGURL="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"
[ -n "$PGURL" ] || die "未设 E2E_DATABASE_URL / DATABASE_URL —— 挂鉴权后没有身份就没有可测的路径"
command -v psql >/dev/null 2>&1 || die "缺少 psql"

psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

SFX="$(date +%s)$RANDOM"
MEMBER_ID="ou_fields_smoke_$SFX"
TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('FIELDS-SMOKE-$SFX', 'fields-smoke-lk-$SFX', 'free') RETURNING id")
[ -n "$TENANT_ID" ] || die "临时租户建不出来"
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_ID', '$MEMBER_ID', 'owner')" >/dev/null

cleanup() {
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.field_definitions WHERE tenant_id = '$TENANT_ID'" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id = '$TENANT_ID'" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenants WHERE id = '$TENANT_ID'" >/dev/null 2>&1
}
trap cleanup EXIT

# works 家族的身份通道（dashboard 生产环境用的就是这条），不是路③ 那条只认会话的闸
AUTH=(-H "X-Feishu-User-Id: $MEMBER_ID")

echo "── fields-auth（挂闸后无身份必须 401）──"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/fields")
[[ "$code" == "401" ]] \
  && ok "GET /fields 无身份返 401（鉴权已挂上）" \
  || fail "GET /fields 无身份返 ${code}（应 401 —— 端点还在裸奔）"

echo "── fields-list ──"
r=$(curl -s "${AUTH[@]}" "$API/api/fields")
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "GET /fields 返回数组" \
  || fail "GET /fields 响应异常 ($r)"

echo "── fields-create ──"
r=$(curl -s -X POST "$API/api/fields" \
    "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d '{"field_name":"smoke-test-field-'"$SFX"'","field_type":"text"}')
echo "$r" | jq -e '.id != null' >/dev/null 2>&1 \
  && ok "POST /fields 创建成功，返回 id" \
  || fail "POST /fields 失败 ($r)"

FIELD_ID=$(echo "$r" | jq -r '.id // empty')

if [[ -n "$FIELD_ID" ]]; then
  echo "── fields-tenant（落库带归属）──"
  n=$(psql_q "SELECT count(*) FROM zenithjoy.field_definitions WHERE id = '$FIELD_ID' AND tenant_id = '$TENANT_ID'")
  [[ "$n" == "1" ]] \
    && ok "新建字段落库带 tenant_id" \
    || fail "新建字段的 tenant_id 不是当前租户 (count=$n)"

  echo "── fields-update ──"
  r2=$(curl -s -X PUT "$API/api/fields/$FIELD_ID" \
      "${AUTH[@]}" \
      -H "Content-Type: application/json" \
      -d '{"field_name":"smoke-updated-'"$SFX"'"}')
  echo "$r2" | jq -e '.id != null' >/dev/null 2>&1 \
    && ok "PUT /fields/:id 更新成功" \
    || fail "PUT /fields/:id 失败 ($r2)"

  echo "── fields-delete ──"
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/fields/$FIELD_ID" "${AUTH[@]}")
  [[ "$http_code" == "200" || "$http_code" == "204" ]] \
    && ok "DELETE /fields/:id 删除成功 (HTTP $http_code)" \
    || fail "DELETE /fields/:id 失败 (HTTP $http_code)"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ fields smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
