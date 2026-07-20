# Contract DoD — Agent 离线静默告警（Sprint 07201705）

task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
版本: 1.0（首轮）
起草日期: 2026-07-20

---

## [BEHAVIOR] 行为断言（≥4 条，合同锁定）

### [BEHAVIOR-01] 同机同次离线只告警一次（去重）

**描述**：同一 `agent_id` 超离线阈值后，连续触发两次扫描，只发送一次飞书告警。

**断言**：
- 扫描第一次 → `alerted` 列表含该 `agent_id`，webhook mock 收到 1 次 POST
- 扫描第二次（`updated_at` 未刷新）→ `alerted` 列表为空，webhook mock 累计仍为 1 次 POST

**vitest 单测**：`apps/api/src/services/__tests__/agent-offline-monitor.test.ts`
- `describe('[BEHAVIOR-01]') → it('同 agent_id 超阈值后，第二次扫描不重复发告警')`
- **必须有 DB mock**（`vi.mock('../../../apps/api/src/db')`）：返回含 stale agent 的行，使 `scanAndAlert` 在无真实 DB 时也能触发去重逻辑
- 连续两次调用 `scanAndAlert`，断言：第一次 `alerted.length=1`，第二次 `alerted.length=0`，`mockFetch` 累计只被调用 1 次

**manual:bash**：
```bash
# 造 stale 行
psql "$DATABASE_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW()-INTERVAL '5h' WHERE agent_id='test-dedup-agent';"
# 第一次扫描
R1=$(curl -sf -X POST http://localhost:3001/api/internal/agent-offline-scan -H 'Content-Type: application/json' -d '{}')
ALERTED1=$(echo "$R1" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']['alerted']))")
[ "$ALERTED1" -ge 1 ] && echo "第一次扫描 alerted=$ALERTED1 PASS" || echo "FAIL"
# 第二次扫描（不刷新 updated_at）—— 硬断言：alerted 不含该 agent_id
R2=$(curl -sf -X POST http://localhost:3001/api/internal/agent-offline-scan -H 'Content-Type: application/json' -d '{}')
ALERTED2_IDS=$(echo "$R2" | python3 -c "import sys,json; [print(a['agent_id']) for a in json.load(sys.stdin)['data']['alerted']]")
echo "$ALERTED2_IDS" | grep -q "test-dedup-agent" && { echo "FAIL: 去重失效，第二次扫描仍含该 agent_id"; exit 1; } || echo "步骤7 去重验证通过"
```

---

### [BEHAVIOR-02] 恢复心跳后发送恢复通知并复位去重

**描述**：已告警的离线机器，`updated_at` 刷新到阈值内后再次扫描，应发送恢复通知，并从去重 Map 移除（下次离线时重新告警）。

**断言**：
- 恢复扫描 → response 中含 `recovered` 列表，含该 `agent_id`
- webhook mock 收到的 POST body 中 text 含"已恢复"或"recovered"
- 再次造 stale → 第三次扫描重新告警（证明去重复位）

**vitest 单测**：`it('[BEHAVIOR-02] 恢复后推恢复通知并复位去重')`

**manual:bash**：
```bash
# 恢复心跳
psql "$DATABASE_URL" -c "UPDATE zenithjoy.agents SET updated_at=NOW() WHERE agent_id='test-dedup-agent';"
R3=$(curl -sf -X POST http://localhost:3001/api/internal/agent-offline-scan -H 'Content-Type: application/json' -d '{}')
echo "$R3" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert len(d['data'].get('recovered',[])) >= 1, 'FAIL: no recovered'
print('[BEHAVIOR-02] recovered PASS')
"
```

---

### [BEHAVIOR-03] 推送失败必须抛错（不 warn 降级）

**描述**：`sendOfflineAlert()` 调用 fetch 失败时，必须 `throw`（打 `console.error`），不得 `console.warn` 静默吞错（INV-01）。

**断言**：
- mock fetch 抛出 `new Error('network fail')` → `sendOfflineAlert()` 的调用方收到 rejected Promise
- vitest spy 确认 `console.error` 被调用，`console.warn` 未被调用

**vitest 单测**：`it('[BEHAVIOR-03] sendOfflineAlert fetch 失败时 throw 不 warn')`

**manual:bash**（注意：此项需 vitest 覆盖，无法纯 bash 验证内部抛错；以下为可观测性替代验证）：
```bash
# 通过向 scan 端点传入无效 webhook_override，断言响应中出现明确错误信号（不接受 alerted 为空作为 PASS 依据）
# 仅接受以下两种明确错误信号之一：
#   1. success=false + error/message 字段
#   2. data.send_errors 或 data.alerted_errors 非空
RESP=$(curl -s -X POST http://localhost:3001/api/internal/agent-offline-scan \
  -H 'Content-Type: application/json' \
  -d '{"threshold_hours":4,"webhook_override":"http://localhost:19996/invalid-port"}')
python3 - "$RESP" <<'EOF'
import sys, json
resp_str = sys.argv[1]
try:
    resp = json.loads(resp_str)
except Exception:
    print("PASS: 响应非 JSON，失败路径已暴露")
    sys.exit(0)
if resp.get('success') is False and ('error' in resp or 'message' in resp):
    print("PASS [BEHAVIOR-03]: success=false + error/message 字段存在")
    sys.exit(0)
data = resp.get('data', {})
if data.get('send_errors') or data.get('alerted_errors'):
    print("PASS [BEHAVIOR-03]: send_errors/alerted_errors 非空")
    sys.exit(0)
print(f"FAIL [BEHAVIOR-03]: 无效 webhook 时响应无明确错误信号（静默吞错）: {resp}")
sys.exit(1)
EOF
# 检查 API 进程 stderr 含 console.error 输出（非 warn）
```

---

### [BEHAVIOR-04] 禁止硬编码 webhook URL（INV-02）

**描述**：`agent-offline-monitor.ts` 源码中不出现任何硬编码的飞书/HTTP webhook URL 字符串；URL 必须从 `process.env.FEISHU_ALERT_WEBHOOK` 读取。

**断言**：
- `grep -r "https://open.feishu.cn" apps/api/src/services/agent-offline-monitor.ts` 输出为空
- `grep -r "FEISHU_ALERT_WEBHOOK" apps/api/src/services/agent-offline-monitor.ts` 输出非空

**vitest 单测**：`it('[BEHAVIOR-04] webhook URL 来自 env 不硬编码')`（验证未设 env 时不发送）

**manual:bash**：
```bash
# 静态扫描：禁止硬编码 URL
if grep -E "https?://open\.feishu|hooks\.slack" apps/api/src/services/agent-offline-monitor.ts; then
  echo "FAIL: hardcoded webhook URL found"
  exit 1
fi
# 确认读取 env
grep "FEISHU_ALERT_WEBHOOK" apps/api/src/services/agent-offline-monitor.ts \
  && echo "[BEHAVIOR-04] PASS: URL 从 env 读取" \
  || { echo "FAIL: FEISHU_ALERT_WEBHOOK 未从 env 读取"; exit 1; }
```

---

### [BEHAVIOR-05] 告警 payload 必须含 hostname/offline_duration_minutes/agent_id（INV-07）

**描述**：webhook POST 的 body 中，`content.text` 字段或 JSON payload 必须包含 `hostname`（字符串）、`offline_duration_minutes`（整数）、`agent_id`（字符串）三个字段或对应信息。

**断言**：
- smoke mock server 捕获的 POST body 经 jq/python 断言三个字段均存在且类型正确
- `offline_duration_minutes` 为整数（`isinstance(..., int)` 或 `Number.isInteger()`），不是浮点

**vitest 单测**：`it('[BEHAVIOR-05] 告警 payload 含 hostname/offline_duration_minutes/agent_id')`

**manual:bash**：
```bash
# 触发扫描并检查 response 中 alerted 条目字段
R=$(curl -sf -X POST http://localhost:3001/api/internal/agent-offline-scan -H 'Content-Type: application/json' -d '{}')
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d['data']['alerted']:
    assert 'hostname' in a and a['hostname'], 'missing hostname'
    assert 'agent_id' in a and a['agent_id'], 'missing agent_id'
    assert 'offline_duration_minutes' in a, 'missing offline_duration_minutes'
    assert isinstance(a['offline_duration_minutes'], int), 'offline_duration_minutes must be int, got: ' + str(type(a['offline_duration_minutes']))
    assert a['offline_duration_minutes'] >= 0, 'offline_duration_minutes must be non-negative'
print('[BEHAVIOR-05] payload fields PASS')
"
```

---

### [BEHAVIOR-06] `GET /api/agent/machines` 离线机器返回 offline_minutes 字段

**描述**：离线机器（`last_seen` 超 3 分钟以上）在 machines 列表中返回整数 `offline_minutes`；在线机器返回 `null`。

**断言**：
- 离线机器：`offline_minutes` 为正整数
- 在线机器：`offline_minutes === null`

**vitest 单测**：无需（依赖 SQL 计算，通过 smoke 端到端验证）

**manual:bash**：
```bash
RESP=$(curl -sf http://localhost:3001/api/agent/machines \
  -H "X-Tenant-Id: $TEST_TENANT_ID")
echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for m in d['data']:
    status = m.get('status')
    om = m.get('offline_minutes')
    if status == 'offline':
        assert om is None or isinstance(om, int), f'offline machine {m[\"hostname\"]}: offline_minutes={om} should be int or null'
    if status == 'online':
        assert om is None, f'online machine {m[\"hostname\"]}: offline_minutes={om} should be null'
print('[BEHAVIOR-06] offline_minutes field PASS')
"
```

---

## 完成标准（DoD Checklist）

验收时所有项必须全绿：

- [ ] `vitest run apps/api/src/services/__tests__/agent-offline-monitor.test.ts` 全通过
- [ ] `bash .github/workflows/scripts/smoke/agent-offline-alert-smoke.sh` 全通过（含变异测试段）
- [ ] `bash .github/workflows/scripts/smoke/machines-smoke.sh` 保持全绿（向后兼容）
- [ ] `bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh` 保持全绿
- [ ] `grep agent-offline-alert-smoke.sh .github/workflows/scripts/smoke-baseline.txt` 有输出
- [ ] `grep "agent-offline-monitor.test.ts" docs/registry/features/*.yml` 有输出
- [ ] `grep -E "AGENT_OFFLINE_THRESHOLD_HOURS|AGENT_SCAN_INTERVAL_MS" apps/api/src/env-registry.ts` 有输出
- [ ] `grep "startAgentOfflineMonitor" apps/api/src/index.ts` 有输出
- [ ] `grep -E "https?://open\.feishu" apps/api/src/services/agent-offline-monitor.ts` 无输出（禁止硬编码）
- [ ] CI `lint-tdd-commit-order` 通过（commit-1 含 smoke/test，commit-2 含实现）

---

## TDD 提交顺序要求（INV-06）

```
commit-1：写失败的 E2E smoke + vitest test（Red 状态）
  - .github/workflows/scripts/smoke/agent-offline-alert-smoke.sh（≥10 行实质内容）
  - apps/api/src/services/__tests__/agent-offline-monitor.test.ts（failing）
  - .github/workflows/scripts/smoke-baseline.txt（追加登记）
  - docs/registry/features/ 补 yml

commit-2：写实现（让 test 从 Red 变 Green）
  - apps/api/src/services/agent-offline-monitor.ts
  - apps/api/src/index.ts（接入 startAgentOfflineMonitor）
  - apps/api/src/routes/agent-machines.ts（offline_minutes 字段）
  - apps/api/src/env-registry.ts（补注册 2 个 env）
  - POST /api/internal/agent-offline-scan 路由注册
```
