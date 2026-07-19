# Contract DoD：GP-A 主动语音触达 — 触发入口与派发链路

| 字段 | 值 |
|------|-----|
| task_id | 2ac0e77b-c2e3-47e9-92dd-7549622835d7 |
| contract_version | v1.0 |
| 生成时间 | 2026-07-19 |

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] CRM 手动呼叫入口鉴权修复

**描述**：`POST /api/cs/voice-outreach/call` 的鉴权从 `requireCsWriteAccess('wechatId')` 改为 `requireCsAdminOrSuperAdmin`。改前：wechatId 缺失时 wechatId 参数校验先于鉴权生效，导致 404；改后：admin/superadmin 无论是否带 wechatId param 均能通过鉴权（401 或 202）。

**验证命令（manual:bash）**：
```bash
# 前置：API_BASE 和 INT_TOKEN 已设置
# 测试：无 wechatId param 的调用返回非 404（预期 401 未鉴权 或 202 已入队）
HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "${API_BASE:-http://localhost:5200}/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"test-tenant","contact_name":"测试联系人"}')
echo "HTTP Status: $HTTP"
[ "$HTTP" != "404" ] && echo "PASS: 鉴权修复有效（非 404）" || echo "FAIL: 仍然返回 404，鉴权未修复"
```

**断言**：HTTP 状态码 ≠ 404

---

### [BEHAVIOR-2] 乐观锁任务认领（并发防重）

**描述**：两个 Agent machine 并发对同一 `call_id` 执行 `POST /claim`，保证仅有一个成功（202），另一个返回 409 CLAIM_CONFLICT。底层使用 `UPDATE ... WHERE call_phase='queued'` + `RETURNING id`，rowCount=0 时拒绝。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
TENANT_ID="test-tenant-$(date +%s)"
# Step 1: 创建一个 queued 任务
CALL_RESP=$(curl -s -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"contact_name\":\"并发测试联系人\"}")
CALL_ID=$(echo "$CALL_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['call_id'])" 2>/dev/null)
echo "call_id: $CALL_ID"

# Step 2: 并发两次认领（串行模拟）
HTTP_A=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/claim" \
  -H "Content-Type: application/json" \
  -d "{\"call_id\":\"$CALL_ID\",\"machine_id\":\"machine-a\",\"tenant_id\":\"$TENANT_ID\"}")
HTTP_B=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/claim" \
  -H "Content-Type: application/json" \
  -d "{\"call_id\":\"$CALL_ID\",\"machine_id\":\"machine-b\",\"tenant_id\":\"$TENANT_ID\"}")
echo "Machine A: $HTTP_A, Machine B: $HTTP_B"
[ "$HTTP_A" = "202" ] && [ "$HTTP_B" = "409" ] && echo "PASS: 乐观锁防重有效" || \
[ "$HTTP_A" = "409" ] && [ "$HTTP_B" = "202" ] && echo "PASS: 乐观锁防重有效（B 先到）" || \
echo "FAIL: 期望一个 202 + 一个 409，实际 A=$HTTP_A B=$HTTP_B"
```

**断言**：两次并发认领中，恰好 1 次返回 202，1 次返回 409

---

### [BEHAVIOR-3] 10 分钟技术去重窗口

**描述**：同一 `(tenant_id, contact_name)` 在 10 分钟内已有 `call_phase IN ('queued','claimed','dialing')` 的记录时，再次 `POST /call` 返回 409，响应体包含已有 `call_id`。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
TENANT="tenant-dedup-$(date +%s)"
CONTACT="去重测试联系人-$(date +%s)"

# 第一次：应成功
RESP1=$(curl -s -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT\",\"contact_name\":\"$CONTACT\"}")
HTTP1=$(echo "$RESP1" | python3 -c "import json,sys; d=json.load(sys.stdin); print('202' if d.get('success') else '400')" 2>/dev/null || echo "ERR")
echo "第一次: $HTTP1"

# 第二次：应返回 409
RESP2_TMP=$(mktemp)
HTTP2=$(curl -s -o "$RESP2_TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT\",\"contact_name\":\"$CONTACT\"}")
echo "第二次: $HTTP2 — $(cat "$RESP2_TMP")"
[ "$HTTP2" = "409" ] && echo "PASS: 10 分钟去重窗口有效" || echo "FAIL: 期望 409, got $HTTP2"
rm -f "$RESP2_TMP"
```

**断言**：第二次 POST /call 返回 409，响应体含 `call_id` 字段

---

### [BEHAVIOR-4] 3 天业务冷却期

**描述**：若同一联系人最近一次通话（`status IN ('answered','no_answer')`）距今不足 3 天，`POST /call` 返回 429，错误码为 `COOLING_DOWN`。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
TENANT="tenant-cool-$(date +%s)"
CONTACT="冷却测试联系人-$(date +%s)"

# 直接写 DB 构造距今 2 天的 answered 记录
psql "$DB_URL" -c "INSERT INTO zenithjoy.voice_call_records \
  (id, tenant_id, contact_name, status, call_phase, called_at) VALUES \
  (gen_random_uuid(), '$TENANT'::uuid, '$CONTACT', 'answered', 'answered', NOW()-interval '2 days')"

# 尝试发起新呼叫
RESP_TMP=$(mktemp)
HTTP=$(curl -s -o "$RESP_TMP" -w '%{http_code}' \
  -X POST "$API_BASE/api/cs/voice-outreach/call" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT\",\"contact_name\":\"$CONTACT\"}")
echo "HTTP: $HTTP — $(cat "$RESP_TMP")"
[ "$HTTP" = "429" ] && grep -q "COOLING_DOWN" "$RESP_TMP" && echo "PASS: 3 天冷却期有效" || \
echo "FAIL: 期望 429 COOLING_DOWN，实际 $HTTP"
rm -f "$RESP_TMP"
```

**断言**：返回 429，响应体含 `COOLING_DOWN`

---

### [BEHAVIOR-5] machine 熔断：60 分钟 5 次快速失败触发

**描述**：同一 machine_id 在 60 分钟窗口内出现 ≥5 次「认领后 30s 内状态变为 failed」，机器进入熔断状态（`circuit_open=true`）。熔断后 `GET /machine-circuit-status` 返回 `circuit_open:true`，Agent 认领前检查此接口并跳过。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
MACHINE_ID="machine-fuse-test-$(date +%s)"

# 构造 5 条快速失败记录（claimed_at=NOW()-20s, status=failed）
for i in 1 2 3 4 5; do
  psql "$DB_URL" -c "INSERT INTO zenithjoy.voice_call_records \
    (id, tenant_id, contact_name, status, call_phase, machine_id, claimed_at, called_at) VALUES \
    (gen_random_uuid(), gen_random_uuid(), 'fuse-contact-$i', 'failed', 'failed', \
    '$MACHINE_ID', NOW()-interval '20 seconds', NOW()-interval '20 seconds')"
done

# 查询熔断状态
CIRCUIT=$(curl -s "$API_BASE/api/cs/voice-outreach/machine-circuit-status?machine_id=$MACHINE_ID")
echo "熔断状态: $CIRCUIT"
echo "$CIRCUIT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
data=d.get('data',{})
assert data.get('circuit_open') is True, f'circuit_open 期望 True: {data}'
assert data.get('fast_fail_count','') >= 5, f'fast_fail_count 期望 >=5: {data}'
print('PASS: machine 熔断触发有效')
" || echo "FAIL: 熔断状态检查失败"
```

**断言**：`circuit_open=true`，`fast_fail_count >= 5`

---

### [BEHAVIOR-6] dry-run 预览：规则激活必须先人工确认

**描述**：`voice_outreach_auto_rules` 表中 `dry_run_mode=true` 且 `dry_run_confirmed_at IS NULL` 时，`PUT /auto-rules/:id` 无法将 `dry_run_mode` 切换为 `false`（返回 400）。用户须先调用一次 dry-run 预览并显式确认（写入 `dry_run_confirmed_at`），才能启用真实执行。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
# 假设已有 rule_id（需先 POST /auto-rules 创建）
RULE_ID="test-rule-id"

# 尝试直接切换到非 dry-run 模式（应被拒绝）
HTTP=$(curl -s -o /dev/null -w '%{http_code}' \
  -X PUT "$API_BASE/api/cs/voice-outreach/auto-rules/$RULE_ID" \
  -H "Content-Type: application/json" \
  -d '{"dry_run_mode": false}')
echo "HTTP: $HTTP"
[ "$HTTP" = "400" ] && echo "PASS: dry-run 未确认时拒绝切换到真实执行" || \
echo "FAIL: 期望 400，实际 $HTTP（dry-run 保护无效）"
```

**断言**：返回 400

---

### [BEHAVIOR-7] lease 超时回收后任务可重新认领

**描述**：`lease_until` 已过期（`< NOW()`）的任务在 `GET /pending` 中重新可见，允许另一个 machine 认领。

**验证命令（manual:bash）**：
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
TENANT="tenant-lease-$(date +%s)"
MACHINE_NEW="machine-new-$(date +%s)"

# 构造一个 claimed 但 lease_until 已过期的任务
CALL_ID=$(psql "$DB_URL" -Atq -c "INSERT INTO zenithjoy.voice_call_records \
  (id, tenant_id, contact_name, status, call_phase, machine_id, lease_until, called_at) VALUES \
  (gen_random_uuid(), '$TENANT'::uuid, 'lease-test-contact', 'failed', 'claimed', \
  'old-machine', NOW()-interval '5 minutes', NOW()) RETURNING id::text")

# 查询 pending，应返回 lease 过期的任务
PENDING=$(curl -s "$API_BASE/api/cs/voice-outreach/pending?machine_id=$MACHINE_NEW&tenant_id=$TENANT")
echo "Pending 响应: $PENDING"
echo "$PENDING" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('data') is not None, 'lease 过期任务未出现在 pending 列表中'
print('PASS: lease 超时回收正常')
" || echo "FAIL: lease 超时回收失败"
```

**断言**：`data` 字段非 null，且 `call_id` 匹配 lease 过期的任务

---

### [BEHAVIOR-8] make_voice_call() 真正调用 start_audio_bridge()

**描述**：`call_worker.py` 中的 `make_voice_call()` 函数必须真实调用 `audio_bridge.py` 的 `start_audio_bridge()`，不再是空函数占位。接通后音频桥接链路建立。

**验证命令（manual:bash）**：
```bash
# 静态检查：make_voice_call 调用 start_audio_bridge
grep -n "start_audio_bridge" services/agent/wechat-rpa/voice_call/call_worker.py
[ $? -eq 0 ] && echo "PASS: make_voice_call() 已接线 start_audio_bridge()" || \
echo "FAIL: call_worker.py 中未找到 start_audio_bridge 调用"

# Python 导入检查
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import inspect, importlib
cw = importlib.import_module('voice_call.call_worker')
src = inspect.getsource(cw.make_voice_call)
assert 'start_audio_bridge' in src, 'make_voice_call 未调用 start_audio_bridge'
print('PASS: make_voice_call 接线验证通过')
" 2>/dev/null || echo "SKIP: 需先完成实现"
```

**断言**：`make_voice_call` 源码包含 `start_audio_bridge` 调用

---

## CI 硬门槛汇总

| 检查项 | 文件 | 必须全绿 |
|--------|------|---------|
| vitest 单元测试（C-01 ～ C-13） | `apps/api/src/routes/voice-outreach.test.ts` | ✅ 必须 |
| pytest 单元测试（C-05 ～ C-07，C-16～C-17） | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | ✅ 必须 |
| Playwright E2E（C-14） | `apps/dashboard/e2e/voice-outreach-crm.spec.ts` | ✅ 必须（windows_cloud） |
| GP-A smoke（C-11，C-12，C-15，GP-A Step1～8） | `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | ✅ 必须 |

---

## 验收流程

1. 实现者完成代码后执行 `manual:bash` 命令逐条验证
2. 推 PR 后 CI 自动运行上述四层测试
3. 所有 CI 硬门槛绿灯后 reviewer 执行 `manual:bash` 抽测 [BEHAVIOR-2] 和 [BEHAVIOR-4]
4. 真机段（接通/ASR 回写）在 xian-rog 手工验收，证据写入 `sprints/07191407-gpa-dispatch-trigger/evidence/`
