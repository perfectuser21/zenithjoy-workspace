#!/usr/bin/env bash
# ai-video-pipeline-local-smoke.sh
# 验证 /api/ai-video-pipeline 本地优先架构（WS1+ contract behavior）
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
LICENSE="${LICENSE:-ZJ-F-FBFYTLFR}"
echo "🔍 smoke: ai-video-pipeline-local — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. createJob 接受 JSON body（local_path），期望返回 201 含 {id,status,original_script,target_aspect}
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LICENSE" \
  -d '{"local_path":"C:\\Users\\test\\video.mp4","topic":"smoke test"}')
[ "$HTTP" = "201" ] || { echo "❌ createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
RES=$(cat "$TMPFILE")
echo "createJob response: $RES"
JOB_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] || { echo "❌ createJob: no id in response"; exit 1; }
echo "✅ createJob OK — id=$JOB_ID"

# 2. POST 201 必填字段完整性
for field in id status original_script target_aspect; do
  echo "$RES" | grep -q "\"$field\"" || { echo "❌ POST 201 缺必填字段: $field"; exit 1; }
done
echo "✅ POST 201 必填字段完整"

# 3. GET /api/ai-video-pipeline/{id} 返回 5 个 PRD 必填字段
GET=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 15 \
  "$BASE_URL/api/ai-video-pipeline/$JOB_ID" \
  -H "Authorization: Bearer $LICENSE")
[ "$GET" = "200" ] || { echo "❌ GET expected 200, got $GET"; cat "$TMPFILE"; exit 1; }
GET_RES=$(cat "$TMPFILE")
for field in id status detected_aspect original_script target_aspect; do
  echo "$GET_RES" | grep -q "\"$field\"" || { echo "❌ GET 缺必填字段: $field"; exit 1; }
done
echo "✅ GET 5 字段完整"

# 4. error path — 缺 local_path 返回 400
ERR_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -d '{"topic":"no local_path"}')
[ "$ERR_CODE" = "400" ] || { echo "❌ 缺 local_path 应返 400，实际 $ERR_CODE"; exit 1; }
echo "✅ 缺 local_path → 400"

# 5. completeJob 接受 output_dir，返回 200
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X PUT "$BASE_URL/api/ai-video-pipeline/$JOB_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{\"output_dir\":\"C:\\\\Users\\\\test\\\\zenithjoy-output\\\\$JOB_ID\"}")
[ "$HTTP" = "200" ] || { echo "❌ completeJob expected 200, got $HTTP"; cat "$TMPFILE"; exit 1; }
echo "✅ completeJob OK"

echo ""
echo "✅ ai-video-pipeline-local smoke 全部通过"
