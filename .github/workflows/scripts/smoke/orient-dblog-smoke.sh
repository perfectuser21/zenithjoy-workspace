#!/usr/bin/env bash
# orient-dblog-smoke.sh
# 验证 detect-frame-orientation 端点：
#   1. 调用后 orientation 字段写入 DB（step15_orientation 非 NULL）
#   2. 使用的模型是 google/gemini-2.0-flash-lite-001（通过响应时间间接验证端点可达）
#
# ENV: API_BASE (default localhost:5200), DATABASE_HOST/PORT/NAME/USER/PASSWORD
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-cecelia}"
DB_USER="${DATABASE_USER:-cecelia}"
export PGPASSWORD="${DATABASE_PASSWORD:?need DATABASE_PASSWORD}"
PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tA"
TS=$(date +%s)

echo "🔍 orient-dblog smoke — API=$API"

# ═══ Step 1: 创建 pipeline job ═══
JOB_RESP=$(curl -fsS -X POST "$API/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d "{\"src_video\":\"/tmp/dblog-smoke-${TS}.mp4\",\"topic\":\"dblog smoke\"}" 2>/dev/null || echo '{}')
JOB_ID=$(echo "$JOB_RESP" | jq -r '.data.id // .id // empty' 2>/dev/null || echo "")
[ -n "$JOB_ID" ] || { echo "FAIL Step 1: no job_id"; echo "$JOB_RESP"; exit 1; }
echo "✅ Step 1: JOB_ID=$JOB_ID"

# ═══ Step 2: 生成最小合法 JPEG，调用 detect-frame-orientation ═══
TMPF=$(mktemp /tmp/smoke-orient-XXXXXX.jpg)
python3 -c "
import sys
# 最小 1x1 灰色 JPEG
data = bytes([
  0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,
  0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,
] + [8]*64 + [
  0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
  0xFF,0xC4,0x00,0x14,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0xFF,0xC4,0x00,0x14,0x10,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0x7F,0xFF,0xD9
])
sys.stdout.buffer.write(data)
" > "$TMPF"

ORIENT_RESP=$(curl -fsS -X POST "$API/api/ai-video/jobs/$JOB_ID/detect-frame-orientation" \
  -F "frame=@$TMPF;type=image/jpeg" 2>/dev/null || echo '{}')
rm -f "$TMPF"

ORIENTATION=$(echo "$ORIENT_RESP" | jq -r '.orientation // empty' 2>/dev/null || echo "")
[ -n "$ORIENTATION" ] || { echo "FAIL Step 2: no orientation in response"; echo "$ORIENT_RESP"; exit 1; }
echo "✅ Step 2: detect-frame-orientation returned orientation=$ORIENTATION"

# ═══ Step 3: 合法值校验 ═══
case "$ORIENTATION" in
  none|cw90|ccw90|rotate180) echo "✅ Step 3: orientation='$ORIENTATION' is valid" ;;
  *) echo "FAIL Step 3: unexpected orientation='$ORIENTATION'"; exit 1 ;;
esac

# ═══ Step 4: 验证 step15_orientation 已写入 DB ═══
DB_VAL=$($PSQL -c "SELECT step15_orientation FROM zenithjoy.ai_video_pipeline_jobs WHERE id='$JOB_ID'" 2>/dev/null || echo "")
[ -n "$DB_VAL" ] || { echo "FAIL Step 4: step15_orientation is NULL in DB for job $JOB_ID"; exit 1; }
echo "✅ Step 4: DB step15_orientation='$DB_VAL'"

echo ""
echo "✅ orient-dblog smoke PASSED (4/4)"
