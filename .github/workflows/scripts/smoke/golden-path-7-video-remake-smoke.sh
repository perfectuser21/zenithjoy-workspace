#!/usr/bin/env bash
# golden-path-7-video-remake-smoke.sh
# Line 07 AI爆款视频翻拍 — 9节点流水线 API smoke
# 验证：POST /api/video-remake/jobs + GET /api/video-remake/jobs/:id schema
set -euo pipefail

API="${API_BASE_URL:-http://localhost:3000}"
echo "=== Line 07 Video Remake API Smoke ==="
echo "API: $API"

# 1. 创建任务（最小 MP4 fixture，若不存在用 HTTP 表单模拟）
FIXTURE="sprints/06100919-line07-video-remake-pipeline/tests/fixtures/test-1s-64x64.mp4"
if [ ! -f "$FIXTURE" ]; then
  echo "WARN: fixture not found at $FIXTURE, using minimal binary"
  FIXTURE="/tmp/smoke-test.mp4"
  printf '\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2' > "$FIXTURE"
fi

echo "--- Step 1: POST /api/video-remake/jobs ---"
RESP=$(curl -sf -X POST \
  "${API}/api/video-remake/jobs" \
  -F "video=@${FIXTURE};type=video/mp4" \
  -w "\nHTTPSTATUS:%{http_code}" \
  2>/dev/null || true)

HTTP_STATUS=$(echo "$RESP" | grep "HTTPSTATUS:" | cut -d: -f2 | tr -d ' \n')
BODY=$(echo "$RESP" | grep -v "HTTPSTATUS:")

echo "  HTTP $HTTP_STATUS: $BODY"

if [ "$HTTP_STATUS" != "200" ]; then
  echo "::error::FAIL POST /api/video-remake/jobs returned $HTTP_STATUS"
  exit 1
fi

JOB_ID=$(node -e "const b=JSON.parse(process.argv[1]);if(!b.job_id){process.exit(1);}console.log(b.job_id)" "$BODY" 2>/dev/null)
STATUS=$(node -e "const b=JSON.parse(process.argv[1]);console.log(b.status)" "$BODY" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
  echo "::error::FAIL job_id 缺失"
  exit 1
fi
if [ "$STATUS" != "queued" ]; then
  echo "::error::FAIL status='$STATUS' (期望 queued)"
  exit 1
fi
echo "  ✅ job_id=$JOB_ID status=$STATUS"

# 2. 获取任务状态，验证 nodes 数组含 9 项
echo "--- Step 2: GET /api/video-remake/jobs/$JOB_ID ---"
JOB=$(curl -sf "${API}/api/video-remake/jobs/${JOB_ID}" 2>/dev/null)
NODE_COUNT=$(node -e "const j=JSON.parse(process.argv[1]);console.log(j.nodes?.length??0)" "$JOB" 2>/dev/null)

if [ "$NODE_COUNT" != "9" ]; then
  echo "::error::FAIL nodes.length=$NODE_COUNT (期望 9)"
  exit 1
fi
echo "  ✅ nodes.length=$NODE_COUNT"

# 3. 验证顶层 schema 字段
FILENAME=$(node -e "const j=JSON.parse(process.argv[1]);console.log(typeof j.filename === 'string' ? 'ok' : 'fail')" "$JOB" 2>/dev/null)
if [ "$FILENAME" != "ok" ]; then
  echo "::error::FAIL getJob 缺 filename(string)"
  exit 1
fi
echo "  ✅ filename OK"

# 4. 验证 N07 select（CI auto）
echo "--- Step 3: POST /api/video-remake/jobs/$JOB_ID/nodes/N07/select ---"
SEL=$(curl -sf -X POST \
  "${API}/api/video-remake/jobs/${JOB_ID}/nodes/N07/select" \
  -H "Content-Type: application/json" \
  -d '{"ci_auto":true}' 2>/dev/null)
SEL_FRAME=$(node -e "const s=JSON.parse(process.argv[1]);console.log(typeof s.selected_frame === 'string' && s.selected_frame.length>0 ? 'ok' : 'fail')" "$SEL" 2>/dev/null)

if [ "$SEL_FRAME" != "ok" ]; then
  echo "::error::FAIL selected_frame 缺失或为空"
  exit 1
fi
echo "  ✅ N07 CI auto-select OK"

echo ""
echo "✅ golden-path-7-video-remake-smoke PASS"
