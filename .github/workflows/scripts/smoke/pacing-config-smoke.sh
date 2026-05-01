#!/usr/bin/env bash
# pacing-config-smoke.sh — 发布节奏配置 smoke
# 验证：get / patch 更新 / 回滚
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── pacing-config-get ──"
r=$(curl -s "$API/api/pacing-config" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.success == true and .data.daily_limit != null' >/dev/null 2>&1 \
  && ok "GET /pacing-config 返回 {success, data: {daily_limit, ...}}" \
  || fail "GET /pacing-config 响应异常 ($r)"

ORIGINAL_LIMIT=$(echo "$r" | jq -r '.data.daily_limit // 5')

echo "── pacing-config-patch ──"
NEW_LIMIT=$(( ORIGINAL_LIMIT + 1 ))
r2=$(curl -s -X PATCH "$API/api/pacing-config" \
    -H "X-Internal-Token: $INT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"daily_limit\": $NEW_LIMIT}")
echo "$r2" | jq -e '.success == true' >/dev/null 2>&1 \
  && ok "PATCH /pacing-config 更新成功" \
  || fail "PATCH /pacing-config 失败 ($r2)"

# 回滚
curl -s -X PATCH "$API/api/pacing-config" \
  -H "X-Internal-Token: $INT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"daily_limit\": $ORIGINAL_LIMIT}" >/dev/null 2>&1
ok "pacing-config 已回滚到原始值 ($ORIGINAL_LIMIT)"

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ pacing-config smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
