#!/usr/bin/env bash
# pipeline-smoke.sh — 内容工厂 Pipeline smoke（media_content_factory）
# 验证：dashboard-stats / trigger / 单条查询 / 列表
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0
# This write-capable contract owns only the job's isolated API and Brain fixture.
[[ "${SMOKE_SCRATCH_API:-}" == 1 ]] || { echo "FAIL: isolated scratch API required"; exit 1; }
case "$API" in http://localhost:*|http://127.0.0.1:*) ;; *) echo "FAIL: loopback API required"; exit 1;; esac
BRAIN="${BRAIN_URL:?isolated Brain protocol fixture required}"
case "$BRAIN" in http://127.0.0.1:*) ;; *) echo "FAIL: loopback Brain fixture required"; exit 1;; esac
curl --fail --silent "$BRAIN/health" | jq -e '.ok == true and .fixture == true' >/dev/null

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── pipeline-dashboard-stats ──"
r=$(curl -s "$API/api/pipeline/dashboard-stats" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e '.total != null and .running != null' >/dev/null 2>&1 \
  && ok "GET /pipeline/dashboard-stats 返回 {total, running, ...}" \
  || fail "GET /pipeline/dashboard-stats 响应异常 ($r)"

echo "── pipeline-list ──"
r=$(curl -s "$API/api/pipeline" -H "X-Internal-Token: $INT_TOKEN")
echo "$r" | jq -e 'if type == "array" then true else .data != null end' >/dev/null 2>&1 \
  && ok "GET /pipeline 端点可达" \
  || fail "GET /pipeline 响应异常 ($r)"

echo "── pipeline-trigger ──"
TOPIC_RESP=$(curl --fail --silent -X POST "$API/api/topics" \
  -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"隔离内容挂号冒烟","priority":1,"status":"已通过"}')
TOPIC_ID=$(printf '%s' "$TOPIC_RESP" | jq -er '.data.id')
r=$(curl --fail --silent -X POST "$API/api/pipeline/trigger" \
    -H "X-Internal-Token: $INT_TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg id "$TOPIC_ID" '{content_type:"solo-company-case",topic:"smoke-test-topic",topic_id:$id}')")
printf '%s' "$r" | jq -e '.success == true and .data.id != null and .data.status == "pending" and (.data.cecelia_task_id | type == "string")' >/dev/null \
  && ok "POST /pipeline/trigger 登记工作单，等待Brain认领，未伪装running" \
  || fail "POST /pipeline/trigger 缺工作单或等待态回执 ($r)"
BRAIN_TASK_ID=$(printf '%s' "$r" | jq -er '.data.cecelia_task_id')
TASK=$(curl --fail --silent "$BRAIN/api/brain/tasks/$BRAIN_TASK_ID")
printf '%s' "$TASK" | jq -e --arg id "$BRAIN_TASK_ID" '.id == $id and .status == "queued" and .claimed_by == null and .payload.business_owner == "zenithjoy"' >/dev/null \
  && ok "Brain独立读回同一queued任务，尚未认领" \
  || fail "Brain任务身份或状态不一致 ($TASK)"

PIPELINE_ID=$(echo "$r" | jq -r '.data.id // empty')

if [[ -n "$PIPELINE_ID" ]]; then
  echo "── pipeline-get-single ──"
  r2=$(curl -s "$API/api/pipeline/$PIPELINE_ID" -H "X-Internal-Token: $INT_TOKEN")
  echo "$r2" | jq -e '.data.id != null or .id != null' >/dev/null 2>&1 \
    && ok "GET /pipeline/:id 返回 pipeline 详情" \
    || fail "GET /pipeline/:id 响应异常 ($r2)"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ pipeline smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
