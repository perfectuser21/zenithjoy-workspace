#!/usr/bin/env bash
# ai-video-checkpoint-smoke.sh — 验证流水线 checkpoint 机制：compose-template 返回有效 HTML + phoneRect
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3001}"
ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

echo "=== ai-video checkpoint smoke ==="

# Step 1: create job with template_id=C
RESP=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\test.mp4","template_id":"C"}') || fail "create job failed" 1
JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ok "created job $JOB_ID with template_id=C"

# Step 2: compose-template must return HTML with phoneRect
COMPOSE=$(curl -sf -X POST "$API_BASE/api/ai-video/jobs/$JOB_ID/compose-template" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"这是一段关于品牌增长的视频测试内容","duration":15}') || fail "compose-template failed" 2

echo "$COMPOSE" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
assert data.get('html'), 'html missing'
assert len(data['html']) > 100, 'html too short'
pr = data.get('phoneRect')
assert pr, 'phoneRect missing for template C'
assert pr.get('x') is not None and pr.get('w',0) > 0, 'phoneRect invalid'
print(f'  html={len(data[\"html\"])} chars, phoneRect={pr}')
" || fail "compose-template response invalid" 2
ok "compose-template returns HTML + phoneRect for template C"

# Step 3: verify template C HTML contains expected markers
echo "$COMPOSE" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
html = data.get('html', '')
assert '#c9a23d' in html or 'template-c' in html or 'Noto Serif' in html, 'template C markers missing'
print('  found template C design markers')
" || fail "template C HTML missing design markers" 3
ok "template C HTML has correct design markers"

# Step 4: verify phoneRect coordinates are sane for 1920x1080 16:9 template
echo "$COMPOSE" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
pr = data.get('phoneRect', {})
assert pr.get('x', 0) > 0, 'x must be > 0'
assert pr.get('y', 0) > 0, 'y must be > 0'
assert pr.get('w', 0) > 100, 'w must be > 100'
assert pr.get('h', 0) > 200, 'h must be > 200'
print(f'  phoneRect valid: x={pr[\"x\"]} y={pr[\"y\"]} w={pr[\"w\"]} h={pr[\"h\"]}')
" || fail "phoneRect coordinates invalid" 4
ok "phoneRect coordinates valid for FFmpeg overlay"

# Step 5: verify aspect ratio for template C is 16:9
echo "$COMPOSE" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
assert data.get('aspect') == '16:9', f'template C must be 16:9, got {data.get(\"aspect\")}'
" || fail "template C aspect != 16:9" 5
ok "template C aspect=16:9 correct"

echo "=== ai-video checkpoint smoke PASS ==="
