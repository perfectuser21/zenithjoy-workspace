#!/bin/bash
# Smoke test: node agent 两阶段协议（PR2a）
# 策略：mock HTTP server（Node.js 内嵌）断言契约层；CI 无抖音 session，真链路归 nightly 真机档。
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

echo "[smoke] node-agent-report-videos: 启动 mock 服务 + 协议断言"

# ────── 1. src/index.ts 内联 collect loop 不得复活（grep 守卫）──────

SRC_INDEX="$REPO_ROOT/services/agent/src/index.ts"
if grep -q "startAcquisitionCollectLoop" "$SRC_INDEX" 2>/dev/null; then
  echo "[FAIL] 1: startAcquisitionCollectLoop 不得存在于 src/index.ts"
  exit 1
fi
if grep -q "processCollectTask" "$SRC_INDEX" 2>/dev/null; then
  echo "[FAIL] 1: processCollectTask 不得存在于 src/index.ts"
  exit 1
fi
echo "[smoke] 1. collect loop 回归守卫: PASS"

# ────── 2. line02/index.ts 新端点迁移校验 ──────

LINE02_INDEX="$REPO_ROOT/services/agent/modules/line02/index.ts"
if ! grep -q "report-videos" "$LINE02_INDEX" 2>/dev/null; then
  echo "[FAIL] 2: line02/index.ts 未包含 /report-videos（新端点未迁移）"
  exit 1
fi
if grep -q "terminal.*stage_1" "$LINE02_INDEX" 2>/dev/null; then
  echo "[FAIL] 2: line02/index.ts 仍存在 terminal:'stage_1' 变通（未删除）"
  exit 1
fi
if grep -E "terminal['\"]?\s*:\s*['\"]done['\"]" "$LINE02_INDEX" 2>/dev/null | grep -v "^[[:space:]]*//" > /dev/null 2>&1; then
  echo "[FAIL] 2: line02/index.ts 仍存在假 terminal:'done'（未删除）"
  exit 1
fi
echo "[smoke] 2. line02 新端点迁移: PASS"

# ────── 3. video_id 正则提取逻辑（无需真实环境）──────

node -e "
const VIDEO_ID_RE = /\/video\/(\d+)/;
const cases = [
  ['https://www.douyin.com/video/7123456789012345678', '7123456789012345678'],
  ['https://v.douyin.com/video/7987654321098765432/', '7987654321098765432'],
  ['https://www.douyin.com/user/MS4w', null],
  ['no-url', null],
  ['https://www.douyin.com/video/abc', null],
];
let ok = true;
for (const [url, expected] of cases) {
  const m = url.match(VIDEO_ID_RE);
  const got = m ? m[1] : null;
  if (got !== expected) {
    console.error('FAIL: url=' + url + ' got=' + got + ' expected=' + expected);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
"
echo "[smoke] 3. video_id 正则提取: PASS"

# ────── 4. mock HTTP server — 断言 report-videos 契约层 ──────

MOCK_PORT=29345

# 启动 mock 服务（Node.js 内嵌，断言请求格式）
node -e "
const http = require('http');
const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    try { body = JSON.parse(body); } catch {}
    calls.push({ url: req.url, method: req.method, headers: req.headers, body });

    // 契约校验
    if (req.url === '/api/acquisition/collect/report-videos' && req.method === 'POST') {
      if (!req.headers['x-agent-id']) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({success:false,error:{code:'MISSING_AGENT_ID'}}));
      }
      if (!body.task_id) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({success:false,error:{code:'MISSING_TASK_ID'}}));
      }
      if (Array.isArray(body.videos) && body.videos.length === 0 && !body.reason) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({success:false,error:{code:'MISSING_REASON'}}));
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({success:true,data:{task_id:body.task_id,status:'stage_1_done',video_count:body.videos?.length??0,accepted:body.videos?.length??0}}));
    }

    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({success:false,error:{code:'NOT_FOUND'}}));
  });
});
server.listen($MOCK_PORT, () => {
  // 写 pid 到 tmp 文件，让 shell 可以 kill
  const fs = require('fs');
  fs.writeFileSync('/tmp/smoke-mock-$MOCK_PORT.pid', String(process.pid));
  console.log('mock server ready on $MOCK_PORT');
});
// 30s 后自动退出（防止 CI 泄漏）
setTimeout(() => process.exit(0), 30000);
" &
MOCK_PID=$!
echo "/tmp/smoke-mock-$MOCK_PORT.pid" > /tmp/smoke-pid-file.txt

# 等待 mock 服务就绪
for i in $(seq 1 10); do
  if curl -sf "http://localhost:$MOCK_PORT/health" > /dev/null 2>&1 || \
     curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$MOCK_PORT/" 2>/dev/null | grep -qE "^(200|404)"; then
    break
  fi
  sleep 0.5
done
sleep 0.5

BASE="http://localhost:$MOCK_PORT"

cleanup() {
  kill $MOCK_PID 2>/dev/null || true
}
trap cleanup EXIT

# 4a. 非空清单：有 task_id + x-agent-id + videos → 200 stage_1_done
RESP=$(curl -sf -w "\n%{http_code}" \
  -X POST "$BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: smoke-agent-001" \
  -d '{"task_id":"smoke-task-001","videos":[{"video_id":"7111111111111111111"},{"video_id":"7222222222222222222"}]}' \
  2>/dev/null)
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
echo "[smoke] 4a report-videos 非空清单 status=$STATUS"
if [ "$STATUS" != "200" ]; then
  echo "[FAIL] 4a: 非空清单应返回 200，实得 $STATUS / $BODY"
  exit 1
fi
if ! echo "$BODY" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.data&&d.data.status==='stage_1_done'?0:1);" 2>/dev/null; then
  echo "[FAIL] 4a: 非空清单应返回 stage_1_done"
  exit 1
fi
echo "[smoke] 4a. 非空清单 → stage_1_done: PASS"

# 4b. 空清单+reason.search_result=empty → 200（mock 接受，服务端落 partial）
RESP=$(curl -sf -w "\n%{http_code}" \
  -X POST "$BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: smoke-agent-001" \
  -d '{"task_id":"smoke-task-002","videos":[],"reason":{"search_result":"empty"}}' \
  2>/dev/null)
STATUS=$(echo "$RESP" | tail -1)
echo "[smoke] 4b report-videos 空清单+empty status=$STATUS"
if [ "$STATUS" != "200" ]; then
  echo "[FAIL] 4b: 空清单+empty 应返回 200，实得 $STATUS"
  exit 1
fi
echo "[smoke] 4b. 空清单+empty → 200: PASS"

# 4c. 空清单+reason.error_code → 200
RESP=$(curl -sf -w "\n%{http_code}" \
  -X POST "$BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: smoke-agent-001" \
  -d '{"task_id":"smoke-task-003","videos":[],"reason":{"error_code":"SEARCH_TIMEOUT"}}' \
  2>/dev/null)
STATUS=$(echo "$RESP" | tail -1)
echo "[smoke] 4c report-videos 空清单+error_code status=$STATUS"
if [ "$STATUS" != "200" ]; then
  echo "[FAIL] 4c: 空清单+error_code 应返回 200，实得 $STATUS"
  exit 1
fi
echo "[smoke] 4c. 空清单+error_code → 200: PASS"

# 4d. 缺 reason（空清单无 reason）→ 400 MISSING_REASON
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: smoke-agent-001" \
  -d '{"task_id":"smoke-task-004","videos":[]}' \
  2>/dev/null)
echo "[smoke] 4d report-videos 空清单无reason status=$RESP"
if [ "$RESP" != "400" ]; then
  echo "[FAIL] 4d: 空清单无 reason 应返回 400，实得 $RESP"
  exit 1
fi
echo "[smoke] 4d. 空清单无reason → 400: PASS"

echo "[smoke] node-agent-report-videos: ALL PASSED"
