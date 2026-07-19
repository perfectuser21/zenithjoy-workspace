#!/usr/bin/env bash
# collect-report-comment-grading-smoke.sh
# Sprint: 评论区留言AI意向分档判定（补齐 Path2 Seg3→Seg4 缺口，decision 4e421ae8）
#
# 验证 /collect/report 真实接入 gradeComments() 后端到端不崩、grade 落库机制真跑通：
#   §1 POST /collect/report（真实 android 客户端从不带 grade 字段）→ 200，不因新增
#      gradeComments() 调用而 500
#   §2 acquisition_leads 真实建行（nickname/comment_text 与请求一致）
#   §3 acquisition_lead_comments 真实建行且与 lead 关联
#   §4 本 CI job 未配置 TOAPIS_API_KEY（glob-runner env 没有该 secret，见
#      ci-smoke-glob-runner.yml），gradeComments() 按其自身文档化的省钱兜底设计会
#      短路返回 null（不崩溃、不误判）——落库 grade 应为 NULL，outreach_eligible
#      应为 false，端到端验证"无 key 时优雅降级"这条真实生产会遇到的路径
#
# "Gemini 判定精准 → grade 落库 + outreach_eligible=true" 这条核心业务断言已由
# apps/api/tests/integration/p2-line02-content-judgment/collect-report-comment-grading.integration.test.ts
# 用真 Postgres + mock axios 验证过（不需要真实外部 API key），此 smoke 补的是
# "真实 HTTP 服务器进程 + 真实 DB + 无 key 兜底路径"这一层，两者互补不重复。
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:5200}"
DB="${DB:-}"

pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*" >&2; exit 1; }
section() { echo; echo "=== $* ==="; }

[ -n "$DB" ] || fail "本 smoke 需要真 DB 连接（\$DB 未设置）"

TENANT_ID=$(node -e "console.log(require('crypto').randomUUID())")
AGENT_ID="smoke-grading-agent-${TENANT_ID}"
VIDEO_ID="smoke-grading-vid-$(date +%s)"
NICKNAME="smoke-grading-nick-$(date +%s)"

psql "$DB" -tA -c \
  "INSERT INTO zenithjoy.tenants (id, name, license_key) VALUES ('${TENANT_ID}', 'smoke-comment-grading', 'smoke-license-${TENANT_ID}')" \
  > /dev/null || fail "预置 tenants 失败"

# trap 在第一条插入成功后立刻注册：后续任何一步预置失败都不会漏清理孤儿行。
TASK_ID=""
cleanup() {
  psql "$DB" -c "DELETE FROM zenithjoy.acquisition_lead_comments WHERE video_id='${VIDEO_ID}'" > /dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='${TENANT_ID}'" > /dev/null 2>&1 || true
  [ -n "$TASK_ID" ] && psql "$DB" -c "DELETE FROM zenithjoy.acquisition_collect_videos WHERE task_id='${TASK_ID}'" > /dev/null 2>&1 || true
  [ -n "$TASK_ID" ] && psql "$DB" -c "DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id='${TASK_ID}'" > /dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='${TENANT_ID}'" > /dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE agent_id='${AGENT_ID}'" > /dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='${TENANT_ID}'" > /dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$DB" -tA -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status) VALUES ('${TENANT_ID}', '${AGENT_ID}', 'online')" \
  > /dev/null || fail "预置 agents 失败"
psql "$DB" -tA -c \
  "INSERT INTO zenithjoy.acquisition_config (tenant_id, target_profile_desc) VALUES ('${TENANT_ID}', '装修行业目标客户，准备装修的业主') ON CONFLICT (tenant_id) DO UPDATE SET target_profile_desc = EXCLUDED.target_profile_desc" \
  > /dev/null || fail "预置 acquisition_config 失败"
TASK_ID=$(psql "$DB" -tA -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status) VALUES ('${TENANT_ID}', '[\"装修\"]', 'running') RETURNING id" \
  | head -1 | tr -d ' \n') || fail "预置 acquisition_collect_tasks 失败"
[ -n "$TASK_ID" ] || fail "acquisition_collect_tasks 未返回 id"
psql "$DB" -tA -c \
  "INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, title) VALUES ('${VIDEO_ID}', '${TASK_ID}', '${TENANT_ID}', '装修保姆级教学')" \
  > /dev/null || fail "预置 acquisition_collect_videos 失败"

section "§1 POST /collect/report（真实客户端 payload，不带 grade 字段）不因接入 gradeComments 而崩"
REPORT_RESP=$(curl -sf -X POST "${BASE_URL}/api/acquisition/collect/report" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: ${AGENT_ID}" \
  -d "{
    \"task_id\": \"${TASK_ID}\",
    \"video_id\": \"${VIDEO_ID}\",
    \"commenters\": [
      {\"nickname\": \"${NICKNAME}\", \"comment_text\": \"预算10万求推荐\", \"douyin_id\": \"smoke-douyin-${VIDEO_ID}\"}
    ],
    \"terminal\": false
  }") || fail "§1: /collect/report 请求失败（可能因 gradeComments 接入后抛未捕获异常）"
echo "  Response: ${REPORT_RESP}"
echo "${REPORT_RESP}" | grep -q '"task_id"' || fail "§1: 响应缺少 task_id 字段"
pass "/collect/report 端到端不崩，正常返回"

section "§2 acquisition_leads 真实建行"
LEAD_ROW=$(psql "$DB" -tA -F'|' -c \
  "SELECT id, outreach_eligible FROM zenithjoy.acquisition_leads WHERE tenant_id='${TENANT_ID}' AND nickname='${NICKNAME}'")
[ -n "$LEAD_ROW" ] || fail "§2: acquisition_leads 未建行"
LEAD_ID=$(echo "$LEAD_ROW" | cut -d'|' -f1)
OUTREACH_ELIGIBLE=$(echo "$LEAD_ROW" | cut -d'|' -f2)
echo "  lead_id=${LEAD_ID} outreach_eligible=${OUTREACH_ELIGIBLE}"
pass "acquisition_leads 真实建行"

section "§3 acquisition_lead_comments 真实建行且与 lead 关联"
COMMENT_GRADE=$(psql "$DB" -tA -c \
  "SELECT grade FROM zenithjoy.acquisition_lead_comments WHERE lead_id='${LEAD_ID}'")
echo "  grade=${COMMENT_GRADE:-<NULL>}"
[ -n "$(psql "$DB" -tA -c "SELECT 1 FROM zenithjoy.acquisition_lead_comments WHERE lead_id='${LEAD_ID}'")" ] \
  || fail "§3: acquisition_lead_comments 未建行"
pass "acquisition_lead_comments 真实建行"

section "§4 无 TOAPIS_API_KEY（本 CI 环境）→ gradeComments 优雅降级，grade=NULL，outreach_eligible=false"
[ -z "$COMMENT_GRADE" ] || fail "§4: 本环境无 TOAPIS_API_KEY，grade 理应为 NULL（省钱兜底），实际=${COMMENT_GRADE}"
[ "$OUTREACH_ELIGIBLE" = "f" ] || fail "§4: grade 为 NULL 时 outreach_eligible 理应为 false，实际=${OUTREACH_ELIGIBLE}"
pass "无 key 优雅降级：grade=NULL, outreach_eligible=false，端到端一致"

echo
echo "=== collect-report-comment-grading-smoke PASSED ==="
