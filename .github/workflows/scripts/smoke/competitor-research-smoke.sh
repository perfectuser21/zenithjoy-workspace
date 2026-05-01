#!/usr/bin/env bash
# competitor-research-smoke.sh — 竞品调研 smoke（crm_scraping）
# 验证：start job / poll status / results 链路
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── competitor-research-start ──"
r=$(curl -s -X POST "$API/api/competitor-research/start" \
    -H "Content-Type: application/json" \
    -d '{"query":"smoke test competitor research"}')
echo "$r" | jq -e '.jobId != null' >/dev/null 2>&1 \
  && ok "POST /competitor-research/start 返回 jobId" \
  || fail "POST /competitor-research/start 失败 ($r)"

JOB_ID=$(echo "$r" | jq -r '.jobId // empty')

if [[ -n "$JOB_ID" ]]; then
  echo "── competitor-research-status ──"
  r2=$(curl -s "$API/api/competitor-research/status/$JOB_ID")
  echo "$r2" | jq -e '.status != null' >/dev/null 2>&1 \
    && ok "GET /competitor-research/status/:jobId 返回 status 字段 ($(echo "$r2" | jq -r '.status'))" \
    || fail "GET /competitor-research/status/:jobId 响应异常 ($r2)"

  echo "── competitor-research-results-404-before-done ──"
  # 刚开始的 job 未完成时 results 应返回 404 或空数据，验证端点存在
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/competitor-research/results/$JOB_ID")
  [[ "$http_code" != "000" ]] \
    && ok "GET /competitor-research/results/:jobId 端点可达 (HTTP $http_code)" \
    || fail "GET /competitor-research/results/:jobId 不可达"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ competitor-research smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
