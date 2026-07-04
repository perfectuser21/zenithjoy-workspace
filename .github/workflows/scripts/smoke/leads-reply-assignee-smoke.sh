#!/usr/bin/env bash
# smoke: line02 leads-reply-assignee — DB schema + API fields + orphan table
# Sprint: 07032333-line02-lead-human-handoff
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
: "${API_BASE_URL:=http://localhost:3000}"

echo "▶ [smoke] acquisition_leads 新列存在性检查..."
psql "$DATABASE_URL" -c \
  "SELECT latest_reply, latest_reply_at, assignee, comment_replied_at FROM zenithjoy.acquisition_leads LIMIT 0" \
  || { echo "FAIL: acquisition_leads 缺新列"; exit 1; }

echo "▶ [smoke] acquisition_orphan_replies 表存在性检查..."
psql "$DATABASE_URL" -c \
  "SELECT video_id, commenter_nickname, reply_text, captured_at, tenant_id FROM zenithjoy.acquisition_orphan_replies LIMIT 0" \
  || { echo "FAIL: acquisition_orphan_replies 表不存在"; exit 1; }

echo "▶ [smoke] GET /api/acquisition/leads schema 检查（无租户头返 401）..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE_URL}/api/acquisition/leads")
[ "$CODE" = "401" ] || { echo "FAIL: 无租户头未返 401 (got $CODE)"; exit 1; }

echo "▶ [smoke] GET /api/acquisition/leads?grade=bad 返 400..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: smoke-tenant" \
  "${API_BASE_URL}/api/acquisition/leads?grade=bogus_grade_smoke")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 grade 未返 400 (got $CODE)"; exit 1; }

echo "✅ leads-reply-assignee smoke PASS"
