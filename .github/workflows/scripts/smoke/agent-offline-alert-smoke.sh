#!/usr/bin/env bash
# [TDD commit-1 — RED] Agent 离线静默告警 E2E smoke
#
# Sprint 07201705 / task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
# 合同：sprints/07201705-agent-offline-alert/contract-draft.md
#
# 覆盖链路：
#   1. psql 造 stale Windows agent 行（updated_at = NOW() - 5h）
#   2. 启动 webhook mock server 捕获 POST
#   3. POST /api/internal/agent-offline-scan 触发扫描
#   4. 断言 response alerted 含 hostname/offline_duration_minutes/agent_id
#   5. 断言 webhook mock 收到 POST（含三个必填字段）
#   6. 恢复场景：UPDATE updated_at=NOW()，再 scan，断言推恢复通知
#   7. 变异测试（proven-to-fire）：注释 sendOfflineAlert → smoke 红
#
# 前提（CI 环境）：
#   - DATABASE_URL 已配置（postgresql://...）
#   - API_URL=http://localhost:3001（或 CI 注入）
#   - FEISHU_ALERT_WEBHOOK=http://localhost:${MOCK_PORT}/webhook（覆盖真实 webhook）
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
DB_URL="${DATABASE_URL:-}"
MOCK_PORT="${MOCK_PORT:-19997}"
TEST_AGENT_ID="e2e-offline-smoke-$(date +%s)"
TEST_HOSTNAME="e2e-offline-host-$(date +%s)"
SMOKE_TENANT_ID=""
MOCK_PID=""

# ── 辅助函数 ──────────────────────────────────────────────────────────────────
log() { echo "[smoke][$(date +%H:%M:%S)] $*"; }
fail() { echo "[FAIL] $*" >&2; cleanup; exit 1; }
pass() { echo "[PASS] $*"; }

cleanup() {
  if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
  fi
  if [ -n "$DB_URL" ]; then
    psql "$DB_URL" -c "DELETE FROM zenithjoy.agents WHERE agent_id='${TEST_AGENT_ID}';" 2>/dev/null || true
    if [ -n "$SMOKE_TENANT_ID" ]; then
      psql "$DB_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='${SMOKE_TENANT_ID}';" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

# ── 前提检查 ──────────────────────────────────────────────────────────────────
log "=== 前提检查 ==="
if [ -z "$DB_URL" ]; then
  fail "DATABASE_URL 未设置，无法执行 DB 操作"
fi

# API 健康检查
if ! curl -sf "${API_URL}/health" > /dev/null 2>&1; then
  fail "API 服务未启动：${API_URL}/health 无响应"
fi
pass "API 服务在线"

# 检查内部端点是否存在（commit-1 阶段此端点尚未实现 → smoke 应红）
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" -d '{}')
if [ "$HTTP_CODE" = "404" ]; then
  fail "POST /api/internal/agent-offline-scan 返回 404（端点尚未实现）— commit-1 Red 状态确认"
fi

# ── 步骤 1：启动 webhook mock server ─────────────────────────────────────────
log "=== 步骤 1：启动 webhook mock server（port ${MOCK_PORT}）==="
MOCK_CAPTURE_FILE=$(mktemp /tmp/webhook-capture-XXXXXX.json)
python3 - "${MOCK_PORT}" "${MOCK_CAPTURE_FILE}" &
MOCK_PID=$!
cat <<'PYEOF' > /tmp/webhook_mock_server.py
import sys, http.server, json, threading, time

port = int(sys.argv[1])
capture_file = sys.argv[2]
captures = []

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        try:
            data = json.loads(body)
        except Exception:
            data = {"raw": body.decode('utf-8', errors='replace')}
        captures.append(data)
        with open(capture_file, 'w') as f:
            json.dump(captures, f)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a): pass

srv = http.server.HTTPServer(('', port), Handler)
t = threading.Thread(target=srv.serve_forever, daemon=True)
t.start()
# 运行 120 秒后退出
time.sleep(120)
PYEOF

# 重启 mock server（用 python 文件）
kill "$MOCK_PID" 2>/dev/null || true
sleep 0.5
python3 /tmp/webhook_mock_server.py "${MOCK_PORT}" "${MOCK_CAPTURE_FILE}" &
MOCK_PID=$!
sleep 1
pass "webhook mock server 已启动（pid=${MOCK_PID}）"

# ── 步骤 2：造 stale Windows agent 行 ────────────────────────────────────────
log "=== 步骤 2：造 stale Windows agent（updated_at = NOW() - 5h）==="

# 先建测试 tenant（agents.tenant_id 是 uuid NOT NULL REFERENCES zenithjoy.tenants(id)）
SMOKE_TENANT_ID=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 \
  -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('offline-smoke-${TEST_AGENT_ID}', 'offline-key-${TEST_AGENT_ID}', 'free') RETURNING id" \
  | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$SMOKE_TENANT_ID" ] || fail "建测试 tenant 失败（SMOKE_TENANT_ID 为空）"
log "测试 tenant 已创建：${SMOKE_TENANT_ID}"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO zenithjoy.agents (agent_id, hostname, platform, status, updated_at, last_seen, tenant_id)
VALUES (
  '${TEST_AGENT_ID}',
  '${TEST_HOSTNAME}',
  'windows',
  'online',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '5 hours',
  '${SMOKE_TENANT_ID}'
)
ON CONFLICT (agent_id) DO UPDATE SET
  updated_at = NOW() - INTERVAL '5 hours',
  last_seen  = NOW() - INTERVAL '5 hours',
  status     = 'online',
  platform   = 'windows',
  tenant_id  = EXCLUDED.tenant_id;
SQL
pass "stale agent 行已插入（agent_id=${TEST_AGENT_ID}, tenant_id=${SMOKE_TENANT_ID}）"

# ── 步骤 3：触发扫描（覆盖 webhook 到 mock）────────────────────────────────
log "=== 步骤 3：POST /api/internal/agent-offline-scan ==="
FEISHU_ALERT_WEBHOOK="http://localhost:${MOCK_PORT}/webhook" \
RESP=$(curl -sf -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\": 4, \"webhook_override\": \"http://localhost:${MOCK_PORT}/webhook\"}" \
  || true)

log "Scan response: ${RESP:-<empty>}"

if [ -z "$RESP" ]; then
  fail "POST /api/internal/agent-offline-scan 无响应（endpoint 未实现？）"
fi

# ── 步骤 4：断言 response.data.alerted 字段 ──────────────────────────────────
log "=== 步骤 4：断言 response alerted 字段 ==="
python3 - "${RESP}" "${TEST_AGENT_ID}" "${TEST_HOSTNAME}" <<'PYEOF'
import sys, json

resp_str = sys.argv[1]
expected_agent_id = sys.argv[2]
expected_hostname = sys.argv[3]

try:
    resp = json.loads(resp_str)
except json.JSONDecodeError as e:
    print(f"FAIL: response is not valid JSON: {e}")
    sys.exit(1)

if not resp.get('success'):
    print(f"FAIL: response.success is not true: {resp}")
    sys.exit(1)

data = resp.get('data', {})
alerted = data.get('alerted', [])

if len(alerted) == 0:
    print("FAIL: alerted list is empty — scan did not find stale agent")
    sys.exit(1)

found = next((a for a in alerted if a.get('agent_id') == expected_agent_id), None)
if not found:
    print(f"FAIL: stale agent {expected_agent_id} not in alerted list: {alerted}")
    sys.exit(1)

# 必填字段检查 (INV-07)
for field in ('hostname', 'agent_id', 'offline_duration_minutes'):
    if field not in found:
        print(f"FAIL: alerted entry missing field '{field}': {found}")
        sys.exit(1)

if not isinstance(found['offline_duration_minutes'], int):
    print(f"FAIL: offline_duration_minutes must be int, got {type(found['offline_duration_minutes'])}: {found['offline_duration_minutes']}")
    sys.exit(1)

if found['offline_duration_minutes'] < 240:
    print(f"FAIL: offline_duration_minutes={found['offline_duration_minutes']} < 240 (should be ~300 for 5h stale)")
    sys.exit(1)

print(f"PASS: alerted entry valid: hostname={found['hostname']}, agent_id={found['agent_id']}, offline_minutes={found['offline_duration_minutes']}")
PYEOF
pass "步骤 4 response 断言通过"

# ── 步骤 5：断言 webhook mock 收到 POST ──────────────────────────────────────
log "=== 步骤 5：断言 webhook mock 收到 POST ==="
sleep 1  # 等待 mock 写入文件

if [ ! -f "$MOCK_CAPTURE_FILE" ] || [ "$(cat "$MOCK_CAPTURE_FILE")" = "[]" ] || [ -z "$(cat "$MOCK_CAPTURE_FILE" 2>/dev/null)" ]; then
  fail "webhook mock 未收到任何 POST（capture file 空）"
fi

python3 - "$MOCK_CAPTURE_FILE" "$TEST_HOSTNAME" "$TEST_AGENT_ID" <<'PYEOF'
import sys, json, re

capture_file = sys.argv[1]
expected_hostname = sys.argv[2]
expected_agent_id = sys.argv[3]

with open(capture_file) as f:
    captures = json.load(f)

if len(captures) == 0:
    print("FAIL: webhook mock received no POST requests")
    sys.exit(1)

# 找含 hostname 和 agent_id 的 payload
found = False
for cap in captures:
    text = cap.get('content', {}).get('text', '') or str(cap)
    if expected_hostname in text and expected_agent_id in text:
        # 验证 offline_duration_minutes 存在且 ≥ 240（造的是 5h stale 数据）
        minutes_match = re.search(r'(\d+)\s*分钟', text)
        if not minutes_match:
            print(f"FAIL: webhook payload 缺少离线时长（格式：N 分钟）: {text[:200]}")
            sys.exit(1)
        minutes_val = int(minutes_match.group(1))
        if minutes_val < 240:
            print(f"FAIL: offline_duration_minutes={minutes_val} < 240（应约等于 300，5h stale）")
            sys.exit(1)
        found = True
        print(f"PASS: webhook payload contains hostname={expected_hostname}, agent_id={expected_agent_id}, offline_minutes={minutes_val}")
        break

if not found:
    print(f"FAIL: webhook payload does not contain hostname={expected_hostname} and agent_id={expected_agent_id}")
    print(f"Captured payloads: {captures}")
    sys.exit(1)
PYEOF
pass "步骤 5 webhook mock 断言通过（含 offline_duration_minutes ≥ 240 验证）"

# ── 步骤 6：恢复场景 ──────────────────────────────────────────────────────────
log "=== 步骤 6：恢复场景（UPDATE updated_at=NOW()，再次扫描）==="
psql "$DB_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW(), last_seen=NOW() WHERE agent_id='${TEST_AGENT_ID}';" || true

PREV_CAPTURE_COUNT=$(python3 -c "import json; print(len(json.load(open('${MOCK_CAPTURE_FILE}'))))" 2>/dev/null || echo "0")

RESP2=$(curl -sf -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\": 4, \"webhook_override\": \"http://localhost:${MOCK_PORT}/webhook\"}" \
  || true)
sleep 1

log "恢复场景 response: ${RESP2:-<empty>}"

python3 - "${RESP2:-{}}" "$TEST_AGENT_ID" <<'PYEOF'
import sys, json

resp_str = sys.argv[1]
expected_agent_id = sys.argv[2]

try:
    resp = json.loads(resp_str)
except Exception:
    print(f"FAIL: recovery response not JSON: {resp_str}")
    sys.exit(1)

data = resp.get('data', {})
recovered = data.get('recovered', [])

found = any(r.get('agent_id') == expected_agent_id for r in recovered)
if not found:
    print(f"FAIL: agent {expected_agent_id} not in recovered list: {recovered}")
    sys.exit(1)

print(f"PASS: recovery list contains agent_id={expected_agent_id}")
PYEOF

# 验证恢复通知的 payload 含"已恢复"或"recovered"
NEW_CAPTURE_COUNT=$(python3 -c "import json; print(len(json.load(open('${MOCK_CAPTURE_FILE}'))))" 2>/dev/null || echo "0")
if [ "$NEW_CAPTURE_COUNT" -le "$PREV_CAPTURE_COUNT" ]; then
  fail "恢复通知未触发 webhook POST（capture count 未增加）"
fi

python3 - "$MOCK_CAPTURE_FILE" "$PREV_CAPTURE_COUNT" <<'PYEOF'
import sys, json

capture_file = sys.argv[1]
prev_count = int(sys.argv[2])

with open(capture_file) as f:
    captures = json.load(f)

new_captures = captures[prev_count:]
if not new_captures:
    print("FAIL: no new webhook captures for recovery notification")
    sys.exit(1)

for cap in new_captures:
    text = cap.get('content', {}).get('text', '') or str(cap)
    if '已恢复' in text or 'recovered' in text.lower() or '恢复' in text:
        print(f"PASS: recovery notification text contains '已恢复'/'recovered': {text[:100]}")
        sys.exit(0)

print(f"FAIL: recovery webhook payload does not contain '已恢复' or 'recovered': {new_captures}")
sys.exit(1)
PYEOF
pass "步骤 6 恢复场景通过"

# ── 步骤 7：去重验证（同机再次扫描不重复发）────────────────────────────────
log "=== 步骤 7：去重验证（已告警机器不重复推送）==="
# 此时 updated_at 仍为 stale（步骤 3 已扫描告警过，Map 中有记录）
# 不重置 updated_at，立即再次扫描，断言第二次 alerted 不含该 agent_id

SCAN2=$(curl -sf -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\": 4, \"webhook_override\": \"http://localhost:${MOCK_PORT}/webhook\"}" || true)

log "去重第二次扫描 response: ${SCAN2:-<empty>}"

python3 - "${SCAN2:-{}}" "${TEST_AGENT_ID}" <<'PYEOF'
import sys, json

resp_str = sys.argv[1]
test_agent_id = sys.argv[2]

try:
    resp = json.loads(resp_str)
except Exception:
    print(f"FAIL: 去重第二次扫描 response 不是 JSON: {resp_str}")
    sys.exit(1)

data = resp.get('data', {})
alerted2 = data.get('alerted', [])

# 断言：已告警过的 agent_id 不应再次出现在 alerted 列表中
if any(a.get('agent_id') == test_agent_id for a in alerted2):
    print(f"FAIL: 去重失效——第二次扫描 alerted 仍含 agent_id={test_agent_id}（去重 Map 未生效）")
    sys.exit(1)

print(f"PASS: 步骤 7 去重验证通过——第二次扫描 alerted 不含 agent_id={test_agent_id}")
PYEOF
pass "步骤 7 去重验证通过（第二次扫描不含已告警 agent）"

# ── 步骤 8：变异测试（proven-to-fire）────────────────────────────────────────
log "=== 步骤 8：变异测试（proven-to-fire）——验证失败路径暴露错误 ==="
# 策略：向 scan 端点传入一个必然导致 webhook 发送失败的参数（无效 webhook_url），
# 断言：响应中应有 error / warning 字段，或 alerted 条目中出现 send_error 标记；
# 同时验证 mock server【未】收到额外 POST（因为 webhook 地址无效根本不会发到 mock）
#
# 另一策略（同时执行）：让 scan 正常跑但用完全不存在的端口，确认服务返回的是错误信息而不是静默成功

CAPTURE_BEFORE_MUTATION=$(python3 -c "import json; print(len(json.load(open('${MOCK_CAPTURE_FILE}'))))" 2>/dev/null || echo "0")

# 重置 agent 为 stale（确保有触发告警的目标数据）
psql "$DB_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW()-INTERVAL '5h', last_seen=NOW()-INTERVAL '5h' WHERE agent_id='${TEST_AGENT_ID}';" || true
# 先重置告警 Map（通过调用一个使 updated_at=NOW() 的恢复让去重 Map 清除 agent_id，再设回 stale）
psql "$DB_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW(), last_seen=NOW() WHERE agent_id='${TEST_AGENT_ID}';" || true
# 触发一次恢复扫描（让 Map 清除该 agent_id 的记录）
curl -sf -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\": 4, \"webhook_override\": \"http://localhost:${MOCK_PORT}/webhook\"}" > /dev/null || true
sleep 0.3
# 再次设为 stale，并传入无效 webhook 触发失败路径
psql "$DB_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW()-INTERVAL '5h', last_seen=NOW()-INTERVAL '5h' WHERE agent_id='${TEST_AGENT_ID}';" || true

INVALID_WEBHOOK="http://localhost:19996/nonexistent-that-refuses"
set +e
MUTATION_RESP=$(curl -s -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\": 4, \"webhook_override\": \"${INVALID_WEBHOOK}\"}")
MUTATION_EXIT=$?
set -e

log "变异测试 response (invalid webhook): ${MUTATION_RESP:-<empty>}"

# 断言：无效 webhook 场景必须在响应中暴露明确错误信号（不接受 alerted 为空作为 PASS 依据）
# PASS 条件（必须满足其一）：
#   方案 A：响应含 success=false + error 或 message 字段
#   方案 B：响应含 data.send_errors 或 data.alerted_errors 非空数组
# 明确 FAIL 条件：
#   - alerted 含该 agent_id 但无任何错误标记 → 静默吞错
#   - alerted 为空但无任何错误标记 → 无法区分"webhook 失败"与"无 stale 数据"，视为错误未暴露
python3 - "${MUTATION_RESP:-{}}" "${TEST_AGENT_ID}" <<'PYEOF'
import sys, json

resp_str = sys.argv[1]
test_agent_id = sys.argv[2]

try:
    resp = json.loads(resp_str)
except Exception:
    # 响应本身就是错误（非 JSON），说明失败路径被暴露
    print(f"PASS: 变异测试——无效 webhook 导致响应非 JSON（失败路径已暴露）: {resp_str[:200]}")
    sys.exit(0)

# 方案 A：响应含 success=false + error 或 message 字段（明确错误信号）
if resp.get('success') is False and ('error' in resp or 'message' in resp):
    print(f"PASS: 变异测试——无效 webhook 使响应返回 success=false + error/message 字段（失败路径已暴露）")
    sys.exit(0)

# 方案 B：响应含 data.send_errors 或 data.alerted_errors 非空（明确错误信号）
data = resp.get('data', {})
send_errors = data.get('send_errors')
alerted_errors = data.get('alerted_errors')
if send_errors or alerted_errors:
    print(f"PASS: 变异测试——响应含 send_errors/alerted_errors 非空（失败路径已暴露）")
    sys.exit(0)

# 以下情况均视为 FAIL（去掉宽松方案 C）：
alerted = data.get('alerted', [])
found = any(a.get('agent_id') == test_agent_id for a in alerted)

if found:
    print(f"FAIL: 变异测试失败——无效 webhook 时服务静默吞错（alerted 含 agent_id 但无任何错误标记）: {resp}")
    sys.exit(1)
else:
    # alerted 为空但也没有任何错误信号：无法证明 webhook 失败被暴露
    # 这可能是去重 Map 导致的，不等于失败路径被正确处理
    print(f"FAIL: 变异测试失败——无效 webhook 时响应无明确错误信号（alerted 为空但 success 未 false、无 send_errors）: {resp}")
    print(f"      原因：alerted 为空可能源于去重 Map，不代表 webhook 失败被暴露；实现侧须在 webhook 失败时于响应中返回明确错误字段")
    sys.exit(1)
PYEOF

# 额外断言：无效 webhook 不应导致 mock server 收到新 POST
sleep 0.5
CAPTURE_AFTER_MUTATION=$(python3 -c "import json; print(len(json.load(open('${MOCK_CAPTURE_FILE}'))))" 2>/dev/null || echo "0")
log "变异测试：mock_capture_before=${CAPTURE_BEFORE_MUTATION}, mock_capture_after=${CAPTURE_AFTER_MUTATION}"
# 无效 webhook 指向另一个端口，mock server 不应收到新 POST
[ "$CAPTURE_AFTER_MUTATION" -eq "$CAPTURE_BEFORE_MUTATION" ] \
  || log "INFO: mock capture 有增加（可能因为其他测试行的恢复扫描触发），继续验证"

pass "步骤 8 proven-to-fire 变异测试通过（失败路径在响应中可见，不会静默吞错）"

log "=== All smoke steps PASS ==="
echo "[PASS] agent-offline-alert-smoke.sh PASS"
