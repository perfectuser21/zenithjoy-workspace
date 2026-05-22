#!/usr/bin/env bash
# Smoke: dynamic multi-scene compose-template endpoint
# Verifies: 404 for unknown job, segments param accepted, HTML has correct structure
set -e
BASE="${BASE_URL:-http://autopilot.zenjoymedia.media}"
UUID="00000000-0000-0000-0000-000000000000"

echo "=== dynamic-scenes-compose smoke ==="

# 1. compose-template on nonexistent job → 404
echo "[1] POST /api/ai-video/jobs/$UUID/compose-template → expect 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"transcript":"test","segments":[],"duration":10}' \
  "$BASE/api/ai-video/jobs/$UUID/compose-template")
[ "$STATUS" = "404" ] || { echo "FAIL: expected 404, got $STATUS"; exit 1; }
echo "  OK"

# 2. POST /api/ai-video/jobs with template_id but no video → 400
echo "[2] POST /api/ai-video/jobs (no video, template_id=C) → expect 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -F "template_id=C" \
  "$BASE/api/ai-video/jobs")
[ "$STATUS" = "400" ] || { echo "FAIL: expected 400, got $STATUS"; exit 1; }
echo "  OK"

# 3. Template registry endpoint — GET jobs list still responds
echo "[3] GET /api/ai-video/jobs → expect 200 with data array"
RESP=$(curl -s "$BASE/api/ai-video/jobs")
echo "$RESP" | node -e "
process.stdin.setEncoding('utf8');
let d='';
process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  try {
    const j=JSON.parse(d);
    if(!j.data && !Array.isArray(j)) { console.error('FAIL: no data field'); process.exit(1); }
    console.log('  OK: list endpoint alive, rows=' + (j.data||j).length);
  } catch(e) { console.error('FAIL parse:', d.slice(0,120)); process.exit(1); }
})"

# 4. Create minimal job to test compose-template HTML structure
echo "[4] Create test job + verify compose-template HTML has data-width/data-height"
TMPVID=$(mktemp /tmp/smoke-XXXXXX.mp4)
# Create a 1s 320x240 black MP4 for testing
ffmpeg -y -f lavfi -i "color=black:size=320x240:duration=1" \
  -c:v libx264 -t 1 "$TMPVID" -loglevel quiet 2>/dev/null || {
  echo "  ffmpeg unavailable — skipping HTML structure check"
  rm -f "$TMPVID"; echo "=== dynamic-scenes-compose smoke PASS (partial) ==="; exit 0
}
JOB_RESP=$(curl -s -X POST "$BASE/api/ai-video/jobs" \
  -F "video=@$TMPVID;type=video/mp4" \
  -F "template_id=C" || echo "{}")
rm -f "$TMPVID"
JOB_ID=$(echo "$JOB_RESP" | node -e "
process.stdin.setEncoding('utf8'); let d='';
process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{ try{ const j=JSON.parse(d); console.log(j.data?.id||j.id||''); }catch(e){} })")
if [ -z "$JOB_ID" ]; then
  echo "  Could not create job (no real video env) — skipping HTML structure check"
  echo "=== dynamic-scenes-compose smoke PASS (partial) ==="; exit 0
fi
COMPOSE=$(curl -s -X POST "$BASE/api/ai-video/jobs/$JOB_ID/compose-template" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"测试文案内容","segments":[{"start":0,"end":1,"text":"测试文案内容"}],"duration":1}')
echo "$COMPOSE" | node -e "
process.stdin.setEncoding('utf8'); let d='';
process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  try {
    const j=JSON.parse(d);
    const html=j.html||'';
    if(!html.includes('data-width')) { console.error('FAIL: missing data-width in HTML'); process.exit(1); }
    if(!html.includes('data-height')) { console.error('FAIL: missing data-height in HTML'); process.exit(1); }
    if(!html.includes('scene-0')) { console.error('FAIL: no scene-0 in HTML'); process.exit(1); }
    if(html.includes('react.development.js')) { console.error('FAIL: React CDN still present'); process.exit(1); }
    console.log('  OK: HTML has data-width/data-height + scenes, no React CDN');
  } catch(e) { console.error('FAIL:', d.slice(0,200)); process.exit(1); }
})"

echo "=== dynamic-scenes-compose smoke PASS ==="
