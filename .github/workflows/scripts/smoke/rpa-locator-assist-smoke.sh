#!/usr/bin/env bash
# rpa-locator-assist-smoke.sh
# AI on-call 横切件 · 刀2a：定位求助端点端到端（真 API + 真库 + 真调 TOAPIS/deepseek）
#
# 真调先例：golden-path-2-smoke.sh Step 8c/23b（CI glob runner 已注入 secrets.TOAPIS_API_KEY）。
# 验证点：
#   1. rpa_locator_assist 表存在（migration 已跑）
#   2. 首问：树+目标 → 真模型指认 → 返回候选 → 出诊病历落库（cache_hit=false, model 非空）
#   3. 二问同缓存键：cache_hit=true，且病历新增行是缓存命中（不再烧模型钱）
#   fail-open / 截断守卫 / 越界防护由 locator-assist.test.ts 单测覆盖（mock 层更可控）。

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

[ -n "${TOAPIS_API_KEY:-}" ] || fail "TOAPIS_API_KEY 未配置——本 smoke 真调模型（同 gp2 Step8c 先例），缺 key 不许静默跳过"

# ── 1. 表存在 ──
GOT=$(psql "$DB" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='rpa_locator_assist'")
[ "$GOT" = "1" ] || fail "rpa_locator_assist 表缺失（migration 未跑）"
ok "rpa_locator_assist 表存在"

DEV="HONOR SMOKE-AN00-$$"
psql "$DB" -c "DELETE FROM zenithjoy.rpa_locator_assist WHERE device_model LIKE 'HONOR SMOKE-AN00%'" >/dev/null

# 树设计成零歧义：目标"搜索输入框"唯一对应 d1 的 EditText（desc 完全同名）
TREE='d0 android.widget.FrameLayout id=- text=\"-\" desc=\"-\" bounds=[0,0][1080,2388]\nd1 android.widget.EditText id=com.ss.android.ugc.aweme:id/et_search_kw text=\"-\" desc=\"搜索输入框\" bounds=[100,80][900,160]\nd1 android.widget.Button id=com.ss.android.ugc.aweme:id/back_btn text=\"返回\" desc=\"-\" click bounds=[0,80][90,160]'

REQ() {
  curl -sf -X POST "$API_BASE/api/agent/burner/locator-assist" -H "Content-Type: application/json" \
    -d "{\"step\":\"dm_search_input\",\"target_desc\":\"搜索输入框\",\"ui_tree_snapshot\":\"$TREE\",\"device_model\":\"$DEV\",\"os_version\":\"Android 12\",\"douyin_version\":\"28.5.0\",\"app_version\":\"2.1.36\",\"error_code\":\"NO_SEARCH_INPUT\"}"
}

# ── 2. 首问：真模型指认（零歧义树，指错说明管线坏了）──
R1=$(REQ) || fail "首问请求失败（应 fail-open 返回 200，5xx 说明路由炸了）"
echo "$R1" | grep -q '"status":"ok"' || fail "首问未拿到答案 — $R1"
echo "$R1" | grep -q 'et_search_kw' || fail "首问候选未指到搜索输入框（真模型指错零歧义目标或行号解析坏）— $R1"
ok "首问真模型指认正确（et_search_kw）"

ROW1=$(psql "$DB" -At -F'|' -c "SELECT cache_hit, COALESCE(model,'') FROM zenithjoy.rpa_locator_assist WHERE device_model='$DEV' ORDER BY created_at ASC LIMIT 1")
echo "$ROW1" | grep -q '^f|.' || fail "首问病历应 cache_hit=false 且 model 非空，实得 '$ROW1'"
ok "首问出诊病历落库（model=$(echo "$ROW1" | cut -d'|' -f2)）"

# ── 3. 二问同键：命中缓存 ──
R2=$(REQ) || fail "二问请求失败"
echo "$R2" | grep -q '"cache_hit":true' || fail "二问未命中缓存 — $R2"
HIT=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.rpa_locator_assist WHERE device_model='$DEV' AND cache_hit=true")
[ "$HIT" -ge 1 ] || fail "缓存命中也必须留病历（刀3 周报要统计命中率），实得 $HIT"
ok "二问命中缓存（同机型×版本×步骤键不再烧模型钱），命中病历 $HIT 行"

# 清理
psql "$DB" -c "DELETE FROM zenithjoy.rpa_locator_assist WHERE device_model='$DEV'" >/dev/null
echo "🎉 rpa-locator-assist smoke 全部通过"
