#!/usr/bin/env bash
# cross-line-seam-smoke.sh — 刀B：跨 Line 接缝云端真后端 E2E
#
# 链路：Line02 acquisition 写侧（真 API）→ [SIMULATED-JOIN] → Line04 CRM 读侧（真 API）+ 双向租户隔离。
#
# ⚠️ 诚实声明（假绿灯纪律，同 PR#1193）：
#   第 3 步 [SIMULATED-JOIN] 用 psql 模拟「lead 被私信引导加企微 → 真人加好友 → agent 扫好友入册」
#   这条现实中的人工链路。两 Line 无代码级自动接缝（Line02 身份=抖音 sec_uid，Line04 身份=微信昵称），
#   本闸守的是：两 Line 后端合跑 / migrations 组合 / 租户链贯通，不代表真机 RPA 接缝已验证。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-cecelia}"
DB_PASS="${DATABASE_PASSWORD:-cecelia}"
DB_NAME="${DATABASE_NAME:-cecelia}"
RUN_ID="$(date +%s)$$"

psql_q() { PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qtAc "$1"; }
fail() { echo "❌ $1"; exit 1; }
ok()   { echo "✅ $1"; }

# 环境探测：本闸需要运行中的 apps/api。Smoke Glob Runner 只起 postgres 不起 API——
# 该环境下诚实 SKIP（同 PR#1193 DPAPI skip 范式），真验证只在 integration-cross-line.yml
# nightly 跑（那里 REQUIRE_API=1，API 不可达=红，不许跳过，防真闸静默变绿）。
if ! curl -fs "$API_BASE/health" >/dev/null 2>&1; then
  if [ "${REQUIRE_API:-0}" = "1" ]; then
    fail "apps/api ($API_BASE) 不可达，且 REQUIRE_API=1 不许跳过——nightly 真闸红"
  fi
  echo "⚠️ SKIPPED: apps/api ($API_BASE) 不可达——本环境无真后端，跨Line接缝真验证只在 integration-cross-line nightly 跑，本次绿灯不代表接缝通过"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "⚠️ cross-line-seam-smoke SKIPPED：apps/api 不可达（本环境无真后端），绿灯不代表跨Line接缝验证通过；真闸 = integration-cross-line nightly（REQUIRE_API=1）" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

echo "== [1/5] 种子：租户 A/B + 成员 + 客服机 + 关键词任务 =="
TENANT_A=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('ci-cross-a-$RUN_ID','lk_cross_a_$RUN_ID') RETURNING id")
TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('ci-cross-b-$RUN_ID','lk_cross_b_$RUN_ID') RETURNING id")
USER_A="ci-cross-a-$RUN_ID"
USER_B="ci-cross-b-$RUN_ID"
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_A','$USER_A','admin'),('$TENANT_B','$USER_B','admin')" >/dev/null
CS_WX="wx_cs_ci_$RUN_ID"
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_A','ci-machine-$RUN_ID','$CS_WX')" >/dev/null
KT_ID=$(psql_q "INSERT INTO zenithjoy.acquisition_keyword_tasks (keyword, tenant_id) VALUES ('护肤','$TENANT_A') RETURNING id")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ -n "$KT_ID" ] || fail "种子失败"
ok "tenant A=$TENANT_A / B=$TENANT_B / keyword_task=$KT_ID"

echo "== [2/5] Line02 写侧：真 API 上报评论 → acquisition_leads =="
SEC_UID="SECCROSS$RUN_ID"
HTTP_BODY=$(curl -sf -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H 'Content-Type: application/json' \
  -d "{\"keyword_task_id\":\"$KT_ID\",\"video_url\":\"https://www.douyin.com/video/ci-cross-$RUN_ID\",\"comments\":[{\"commenter_id\":\"/user/$SEC_UID\",\"text\":\"求链接，怎么买\",\"grade\":\"A\",\"keyword\":\"护肤\"}]}") \
  || fail "写侧 API 调用失败"
echo "$HTTP_BODY" | grep -q '"written_count":1' || fail "written_count != 1: $HTTP_BODY"
LEAD_TENANT=$(psql_q "SELECT tenant_id FROM zenithjoy.acquisition_leads WHERE sec_uid='$SEC_UID'")
[ "$LEAD_TENANT" = "$TENANT_A" ] || fail "lead 未落库或租户错: '$LEAD_TENANT'"
KT_STATUS=$(psql_q "SELECT status FROM zenithjoy.acquisition_keyword_tasks WHERE id='$KT_ID'")
[ "$KT_STATUS" = "done" ] || fail "keyword_task 未标 done（回归 PR#1186 类）: '$KT_STATUS'"
ok "lead 落库 tenant=A，keyword_task=done"

echo "== [3/5] [SIMULATED-JOIN] ⚠️ 模拟人工加微链路（私信引导加企微→真人加好友→agent 扫好友入册），非真实 RPA 接缝 =="
CONTACT="crossline-customer-$RUN_ID"
psql_q "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, source) VALUES ('$TENANT_A','$CS_WX','$CONTACT','scan')" >/dev/null
psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT_A','$CONTACT','in','你好，我从抖音评论区来的')" >/dev/null
ok "已模拟入册: $CONTACT"

echo "== [4/5] Line04 读侧：CRM 名册可见该客户 =="
CRM_A=$(curl -sf -H "X-Feishu-User-Id: $USER_A" "$API_BASE/api/crm/customers") || fail "CRM API 调用失败"
echo "$CRM_A" | grep -q "$CONTACT" || fail "tenant A 名册看不到 $CONTACT"
ok "tenant A 名册可见 $CONTACT"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  echo "== [FIRE_TEST] 故意断言不存在的客户（proven-to-fire 验证）=="
  echo "$CRM_A" | grep -q "fire-test-nonexistent-customer" || fail "FIRE_TEST：预期失败——本闸证明会咬人"
fi

echo "== [5/5] 双向租户隔离 =="
CRM_B=$(curl -sf -H "X-Feishu-User-Id: $USER_B" "$API_BASE/api/crm/customers") || fail "CRM API (B) 调用失败"
if echo "$CRM_B" | grep -q "$CONTACT"; then fail "租户隔离破裂：tenant B 看到了 A 的客户"; fi
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/crm/customers")
[ "$HTTP_CODE" = "401" ] || fail "无头访问应 401，实际 $HTTP_CODE"
LEAK=$(psql_q "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE sec_uid='$SEC_UID' AND tenant_id <> '$TENANT_A'")
[ "$LEAK" = "0" ] || fail "lead 泄漏到其他租户"
ok "隔离双向成立（B 不可见 A / 无头 401 / lead 无泄漏）"

echo "🎉 跨 Line 接缝 E2E 全部通过（第 3 步为 SIMULATED-JOIN 模拟，非真机 RPA）"
