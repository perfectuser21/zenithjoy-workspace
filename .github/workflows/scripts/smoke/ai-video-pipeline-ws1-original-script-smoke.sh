#!/usr/bin/env bash
# ai-video-pipeline-ws1-original-script-smoke.sh
# Verifies WS1 fields: original_script + target_aspect + detected_aspect in createJob response
# Companion to ai-video-pipeline-local-smoke.sh; run standalone for WS1-specific field validation.
set -euo pipefail

BASE_URL="${BASE_URL:-https://autopilot.zenjoymedia.media}"
LICENSE="${LICENSE:-ZJ-F-FBFYTLFR}"
echo "🔍 smoke: ai-video-pipeline-ws1-original-script — $BASE_URL"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# 1. POST with original_script + target_aspect → 201 with .job nested object containing new fields
HTTP=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 30 \
  -X POST "$BASE_URL/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LICENSE" \
  -d '{"local_path":"C:\\Users\\test\\video.mp4","topic":"ws1 smoke","original_script":"测试原始文案","target_aspect":"9:16"}')
[ "$HTTP" = "201" ] || { echo "❌ createJob expected 201, got $HTTP"; cat "$TMPFILE"; exit 1; }
RES=$(cat "$TMPFILE")
echo "createJob response: $RES"

# 2. .job nested object exists
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'job' in d and isinstance(d['job'], dict), 'FAIL: .job missing or not object'
print('OK: .job is object')
" || exit 1

# 3. All required fields present including status
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
job = d['job']
for f in ('id', 'status', 'original_script', 'target_aspect', 'detected_aspect'):
    assert f in job, f'FAIL: .job missing field {f}'
print('OK: all required fields present')
" || exit 1

# 4. original_script echoed back correctly
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d['job'].get('original_script')
assert v == '测试原始文案', f'FAIL: original_script wrong: {v}'
print('OK: original_script echoed')
" || exit 1

# 5. target_aspect echoed back correctly
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d['job'].get('target_aspect')
assert v == '9:16', f'FAIL: target_aspect wrong: {v}'
print('OK: target_aspect echoed')
" || exit 1

# 6. detected_aspect is null initially (set by ffprobe later)
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
v = d['job'].get('detected_aspect')
assert v is None, f'FAIL: detected_aspect should be null initially, got: {v}'
print('OK: detected_aspect is null')
" || exit 1

# 7. No camelCase leak
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'originalScript' not in d['job'], 'FAIL: camelCase originalScript leaked in .job'
assert 'originalScript' not in d, 'FAIL: camelCase originalScript leaked at top level'
print('OK: snake_case only')
" || exit 1

echo ""
echo "✅ ai-video-pipeline-ws1-original-script smoke 全部通过"
