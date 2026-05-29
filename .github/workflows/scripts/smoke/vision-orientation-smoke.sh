#!/usr/bin/env bash
# vision-orientation-smoke.sh
# 验证 /detect-frame-orientation 端点存在且能接受 multipart 图片上传
#
# ENV: API_BASE (default localhost:5200), DATABASE_HOST/PORT/NAME/USER/PASSWORD
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-zenithjoy}"
DB_USER="${DATABASE_USER:-zenithjoy}"
export PGPASSWORD="${DATABASE_PASSWORD:?need DATABASE_PASSWORD}"
PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tA"
TS=$(date +%s)

echo "🔍 vision-orientation smoke — API=$API"

# ═══ Step 1: 创建 ai_video_pipeline_jobs 行，拿到 job id ═══
EMAIL="vision-smoke-${TS}@example.com"
SIGNUP=$(curl -fsS -X POST "$API/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke!2026\",\"name\":\"VisionSmoke\"}" 2>/dev/null || echo '{}')
TOKEN=$(echo "$SIGNUP" | jq -r '.token // empty' 2>/dev/null || echo "")

JOB_RESP=$(curl -fsS -X POST "$API/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d "{\"src_video\":\"/tmp/smoke-test.mp4\",\"topic\":\"vision smoke test\"}" 2>/dev/null || echo '{}')
JOB_ID=$(echo "$JOB_RESP" | jq -r '.data.id // .id // empty' 2>/dev/null || echo "")
[ -n "$JOB_ID" ] || { echo "Step 1 FAIL: no job_id from /api/ai-video/jobs"; echo "$JOB_RESP"; exit 1; }
echo "✅ Step 1: JOB_ID=$JOB_ID"

# ═══ Step 2: 用 1×1 JPEG 调用 detect-frame-orientation ═══
# 最小合法 JPEG（8 bytes header + minimal content）
TMPF=$(mktemp /tmp/smoke-frame-XXXXXX.jpg)
# Generate a tiny valid JPEG using printf (minimal 1x1 white JPEG)
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\x27",;\x1c\x1c(7),\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&'"'"'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd4P\x00\x00\x00\x1f\xff\xd9' > "$TMPF" 2>/dev/null || {
  # Fallback: use Python to write a minimal valid JPEG
  python3 -c "
import sys
data = bytes([0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,
              0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xD9])
sys.stdout.buffer.write(data)
" > "$TMPF"
}

ORIENT_RESP=$(curl -fsS -X POST "$API/api/ai-video/jobs/$JOB_ID/detect-frame-orientation" \
  -F "frame=@$TMPF;type=image/jpeg" 2>/dev/null || echo '{}')
rm -f "$TMPF"

ORIENTATION=$(echo "$ORIENT_RESP" | jq -r '.orientation // empty' 2>/dev/null || echo "")
[ -n "$ORIENTATION" ] || { echo "Step 2 FAIL: no orientation in response"; echo "$ORIENT_RESP"; exit 1; }
echo "✅ Step 2: detect-frame-orientation responded orientation=$ORIENTATION"

# ═══ Step 3: orientation 必须是合法值之一 ═══
case "$ORIENTATION" in
  none|cw90|ccw90|rotate180)
    echo "✅ Step 3: orientation='$ORIENTATION' is a valid value"
    ;;
  *)
    echo "Step 3 FAIL: unexpected orientation='$ORIENTATION'"
    exit 1
    ;;
esac

echo ""
echo "✅ vision-orientation smoke PASSED (3/3)"
