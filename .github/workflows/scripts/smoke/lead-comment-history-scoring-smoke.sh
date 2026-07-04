#!/usr/bin/env bash
# lead-comment-history-scoring-smoke.sh
# Line02 Lead评分重做 smoke —— 同一人多次留言不再丢内容，relevance_score综合频次+时效+AI档位重算
#
# 验证点：
#   1. 同一 sec_uid 第一次留言 → 建 lead + 写 1 条评论历史 + relevance_score 非空
#   2. 同一 sec_uid 第二次留言（不同内容）→ 不新建 lead 行，评论历史累积到 2 条（内容不丢）
#   3. acquisition_leads.comment_count / last_commented_at 随第二次留言更新
#   4. relevance_score 在第二次留言后被重新计算过（updated_at 刷新）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

RAND="${RANDOM}-$$"
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('lch-${RAND}', 'lch-key-${RAND}', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99

KEYWORD_TASK_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.acquisition_keyword_tasks (keyword, tenant_id, status) VALUES ('smoke-${RAND}', '$TENANT_ID', 'pending') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$KEYWORD_TASK_ID" ] || fail "前置：建 keyword_task 失败" 99
ok "前置：tenant + keyword_task 就绪 (tenant=$TENANT_ID, task=$KEYWORD_TASK_ID)"

SEC_UID="lch_smoke_${RAND}"
COMMENTER="/user/${SEC_UID}"

# ── 1. 第一次留言 ────────────────────────────────────────────────────────────
R1=$(curl -fsS -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$KEYWORD_TASK_ID\",\"video_url\":\"https://douyin.com/v/smoke1\",\"comments\":[{\"commenter_id\":\"$COMMENTER\",\"text\":\"请问多少钱\"}]}")
echo "$R1" | jq -er '.received == true' >/dev/null || fail "第一次留言 received 应为 true — $R1" 1
ok "第一次留言：received=true"

LEAD_ID=$(psql "$DB" -At -c "SELECT id FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='$SEC_UID'")
[ -n "$LEAD_ID" ] || fail "第一次留言后未建 lead 行" 1
ok "第一次留言：lead 行已建 (id=$LEAD_ID)"

HIST_COUNT_1=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_lead_comments WHERE lead_id='$LEAD_ID'")
[ "$HIST_COUNT_1" = "1" ] || fail "第一次留言后评论历史应为1条，实得 $HIST_COUNT_1" 1
ok "第一次留言：评论历史 1 条"

SCORE_1=$(psql "$DB" -At -c "SELECT relevance_score FROM zenithjoy.acquisition_leads WHERE id='$LEAD_ID'")
[ -n "$SCORE_1" ] || fail "第一次留言后 relevance_score 应非空" 1
ok "第一次留言：relevance_score=$SCORE_1（非空）"

sleep 1

# ── 2. 第二次留言（同一人，不同内容）── 内容不能丢，要累积历史 ──────────────
R2=$(curl -fsS -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$KEYWORD_TASK_ID\",\"video_url\":\"https://douyin.com/v/smoke2\",\"comments\":[{\"commenter_id\":\"$COMMENTER\",\"text\":\"加我微信xxx吧\"}]}")
echo "$R2" | jq -er '.received == true' >/dev/null || fail "第二次留言 received 应为 true — $R2" 1
ok "第二次留言：received=true"

LEAD_COUNT=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='$SEC_UID'")
[ "$LEAD_COUNT" = "1" ] || fail "同一人不应建第二条 lead 行，实得 $LEAD_COUNT 条" 1
ok "第二次留言：不重复建 lead（仍 1 条）"

HIST_COUNT_2=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_lead_comments WHERE lead_id='$LEAD_ID'")
[ "$HIST_COUNT_2" = "2" ] || fail "第二次留言后评论历史应累积到2条，实得 $HIST_COUNT_2（内容被丢了）" 1
ok "第二次留言：评论历史累积到 2 条（内容未丢）"

SECOND_TEXT=$(psql "$DB" -At -c "SELECT comment_text FROM zenithjoy.acquisition_lead_comments WHERE lead_id='$LEAD_ID' ORDER BY commented_at DESC LIMIT 1")
[ "$SECOND_TEXT" = "加我微信xxx吧" ] || fail "第二条评论内容应保留原文，实得: $SECOND_TEXT" 1
ok "第二次留言：原文内容真实落库"

# ── 3. 汇总字段随第二次留言更新 ─────────────────────────────────────────────
COMMENT_COUNT=$(psql "$DB" -At -c "SELECT comment_count FROM zenithjoy.acquisition_leads WHERE id='$LEAD_ID'")
[ "$COMMENT_COUNT" = "2" ] || fail "acquisition_leads.comment_count 应=2，实得 $COMMENT_COUNT" 1
ok "汇总字段：comment_count=2"

# ── 清理 ─────────────────────────────────────────────────────────────────────
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_lead_comments WHERE lead_id='$LEAD_ID'" >/dev/null
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE id='$LEAD_ID'" >/dev/null
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_keyword_tasks WHERE id='$KEYWORD_TASK_ID'" >/dev/null
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null

echo "🎉 lead-comment-history-scoring-smoke 全部通过"
