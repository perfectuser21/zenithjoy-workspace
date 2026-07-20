# Contract Draft — Agent 离线静默告警（Sprint 07201705）

task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
sprint_dir: sprints/07201705-agent-offline-alert
版本: 1.0（首轮，无 reviewer feedback）
起草日期: 2026-07-20

---

## 范围声明

本合同约束 Sprint 07201705 所有产出物的验收标准。
本 Sprint 属于 **Ops Infra**（非 user_facing Journey）；不推进 Path 1/2/4 Step，但须保持 `golden-path-1-smoke.sh` 全绿。

---

## 交付物清单

| 产物 | 路径 | 状态（交付时） |
|------|------|-------------|
| 离线监控服务 | `apps/api/src/services/agent-offline-monitor.ts` | 新建 |
| 内部触发路由 | 注册至 `apps/api/src/app.ts` 的 `POST /api/internal/agent-offline-scan` | 新建 |
| index.ts 接入 | `apps/api/src/index.ts`：`startAgentOfflineMonitor()` 调用 | 修改 |
| machines 路由扩展 | `apps/api/src/routes/agent-machines.ts`：`offline_minutes` 字段 | 修改 |
| env-registry 补录 | `apps/api/src/env-registry.ts`：`AGENT_OFFLINE_THRESHOLD_HOURS` / `AGENT_SCAN_INTERVAL_MS` | 修改 |
| E2E smoke | `.github/workflows/scripts/smoke/agent-offline-alert-smoke.sh` | 新建（commit-1 failing） |
| vitest 单测 | `apps/api/src/services/__tests__/agent-offline-monitor.test.ts` | 新建（commit-1 failing） |
| CI baseline 登记 | `.github/workflows/scripts/smoke-baseline.txt` 追加 `agent-offline-alert-smoke.sh` | 修改 |
| 测试文件 registry | `docs/registry/features/` 下对应 yml 补录测试文件路径 | 修改 |

---

## 技术约束

### 复用现有飞书告警通道

- 沿用 `wechat-heartbeat.ts` 的 `FEISHU_ALERT_WEBHOOK` env + `{msg_type:'text', content:{text:...}}` POST JSON 格式
- 禁止硬编码 webhook URL（INV-02）
- 未配 `FEISHU_ALERT_WEBHOOK` 时：仅打 `console.info` 日志，不 throw（服务可在无 webhook 环境启动）

### 推送失败必须 throw（INV-01）

```typescript
// 正确：
try {
  await fetch(webhook, { ... });
} catch (err) {
  console.error('[agent-offline-monitor] 飞书告警发送失败:', err);
  throw err;  // 必须 re-throw，不得 warn 吞掉
}
```

禁止 `console.warn` 静默吞错（参考 `wechat-heartbeat.ts` L98/L111 的反例——那是已知技术债）。

### 去重机制（INV-03）

- 进程内 `Map<string, Date> alertedAt`：key = `agent_id`
- 首次超阈值 → 写入 Map，发告警
- 再次扫描仍超阈值 → 跳过（Map 中有记录）
- `updated_at` 刷新到阈值内（恢复） → 从 Map 删除，发恢复通知
- 进程重启后 Map 清空 = 重新告警一次（thin 设计，可接受）

### 告警 payload 格式（INV-07）

```json
{
  "msg_type": "text",
  "content": {
    "text": "[ZenithJoy Agent 离线告警] hostname=<hostname> agent_id=<agent_id> 已离线 <offline_duration_minutes> 分钟（阈值 <threshold>h）"
  }
}
```

必须包含：`hostname`（字符串）、`offline_duration_minutes`（整数）、`agent_id`（字符串）。

### 内部触发端点

```
POST /api/internal/agent-offline-scan
Response: { success: true, data: { scanned: N, alerted: [{ agent_id, hostname, offline_minutes }] } }
```

此端点无鉴权（内部/smoke 调用），不暴露给 dashboard 前端。

### `GET /api/agent/machines` 扩展字段

`normMachine()` 新增 `offline_minutes: number | null`：
- 在线（`last_seen > NOW() - 3m`）→ `null`
- 离线 → `Math.floor((now - last_seen_ms) / 60000)`

向后兼容：现有 `machines-smoke.sh` 断言不更改。

---

## E2E 验收

### 完整验收命令序列（可直接在 CI/本地执行）

```bash
# 前提：API 服务已启动（port 3001），已有 test DB 连接，已有 test tenant
export API_URL=${API_URL:-http://localhost:3001}
export TEST_TENANT_ID=${TEST_TENANT_ID:-test-tenant-id}
export FEISHU_ALERT_WEBHOOK=${FEISHU_ALERT_WEBHOOK:-http://localhost:9999/webhook-mock}

# 场景 A：离线告警触发
bash .github/workflows/scripts/smoke/agent-offline-alert-smoke.sh
```

### smoke 脚本覆盖的完整链路

1. **psql 造 stale 行**：`zenithjoy.agents` 插入 `platform='windows', status='online', updated_at = NOW() - INTERVAL '5h'`
2. **启动 webhook mock server**（`nc -l` 或 Python HTTP server 捕获 POST）
3. **POST `/api/internal/agent-offline-scan`** 触发扫描
4. **断言 response**：`data.alerted` 数组长度 ≥1，含 `hostname`、`offline_duration_minutes`（整数 ≥240）、`agent_id`
5. **断言 webhook mock**：收到的 body 含 `hostname`、`offline_duration_minutes`（整数，≥240）、`agent_id`；text 字段格式为 `N 分钟`，数值 ≥ 240
6. **恢复场景**：UPDATE `updated_at = NOW()`，再 POST scan，断言推恢复通知（text 含"已恢复"/"recovered"）
7. **去重验证（硬断言）**：不重置 `updated_at`，立即再次 POST scan，断言第二次响应 `alerted` 数组**不含**该 `agent_id`（`grep -q → fail` 硬断言）
8. **变异测试（proven-to-fire）**：在 smoke 内传入无效 `webhook_override`（端口不存在）触发失败路径，仅接受以下明确错误信号之一作为 PASS 条件：
   - 响应中 `success === false` 且含 `error` 或 `message` 字段
   - 响应中 `data.send_errors` 或 `data.alerted_errors` 为非空数组
   
   **明确禁止宽松逃逸**：`alerted` 为空不等于 PASS（可能来自去重 Map，不代表 webhook 失败被暴露）；若响应无上述明确错误信号，无论 `alerted` 是否为空均判定 FAIL。
   
   同时断言 mock server 未收到额外 POST（无效端口不应到达 mock server）。
   
   此步骤直接验证 INV-01：webhook 失败路径不得静默吞错，必须在 API 响应中可观测。

### e2e-verify.sh（快速本地验证，无变异测试段）

```bash
#!/usr/bin/env bash
set -euo pipefail
API_URL="${API_URL:-http://localhost:3001}"
DB_URL="${DATABASE_URL:-postgres://localhost:5432/zenithjoy}"
MOCK_PORT=19999

# 启动 webhook mock
python3 -c "
import http.server, threading, json
class H(http.server.BaseHTTPRequestHandler):
    captured=[]
    def do_POST(self):
        n=int(self.headers.get('Content-Length',0))
        H.captured.append(json.loads(self.rfile.read(n)))
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
srv=http.server.HTTPServer(('',${MOCK_PORT}),H)
t=threading.Thread(target=srv.serve_forever,daemon=True); t.start()
import time; time.sleep(60)
" &
MOCK_PID=$!
sleep 1

# 造 stale agent 行
AGENT_ID="e2e-offline-test-$(date +%s)"
psql "$DB_URL" -c "
  INSERT INTO zenithjoy.agents (agent_id, hostname, platform, status, updated_at, last_seen, tenant_id)
  VALUES ('${AGENT_ID}', 'e2e-host-offline', 'windows', 'online',
          NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours', 'test-tenant-id')
  ON CONFLICT (agent_id) DO UPDATE SET updated_at = NOW() - INTERVAL '5 hours', status='online';"

# 触发扫描（AGENT_OFFLINE_THRESHOLD_HOURS=4 默认）
RESP=$(curl -sf -X POST "${API_URL}/api/internal/agent-offline-scan" \
  -H "Content-Type: application/json" \
  -d "{\"threshold_hours\":4}")

echo "Scan response: $RESP"

# 断言 alerted 列表非空
ALERTED=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']['alerted']))")
[ "$ALERTED" -ge 1 ] || { echo "FAIL: alerted list empty"; kill $MOCK_PID 2>/dev/null; exit 1; }

# 断言 payload 含必填字段
echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d['data']['alerted']:
    assert 'hostname' in a, 'missing hostname'
    assert 'offline_duration_minutes' in a, 'missing offline_duration_minutes'
    assert isinstance(a['offline_duration_minutes'], int), 'offline_duration_minutes must be int'
    assert 'agent_id' in a, 'missing agent_id'
print('payload assertions PASS')
"

# 清理
psql "$DB_URL" -c "DELETE FROM zenithjoy.agents WHERE agent_id='${AGENT_ID}';" 2>/dev/null || true
kill $MOCK_PID 2>/dev/null || true
echo "e2e-verify PASS"
```

---

## 未覆盖真实链路清单

| 链路 | 原因 | 等价断言 |
|------|------|---------|
| 真实飞书 webhook 收到推送 | CI 无法访问飞书外网；GHA Secret `FEISHU_ALERT_WEBHOOK` 在 nightly 中有效但不做断言 | smoke 中用本地 mock HTTP server 捕获 POST，验证 payload 结构 |
| 进程内 `setInterval` 60 秒触发 | CI 不等待 60s | 通过 `POST /api/internal/agent-offline-scan` 内部端点等价触发 |
| Windows Agent 实际进程死亡 | 真机离线不可模拟 | psql 直改 `updated_at` 模拟心跳超时 |
| 多实例中台去重 | thin 阶段进程内 Map，多实例场景不适用 | 单实例去重逻辑由 vitest 单测覆盖 |

---

## Invariant 覆盖确认

| INV | 合同对应条款 |
|-----|------------|
| INV-01 | "推送失败必须 throw" 章节；vitest 单测 `[BEHAVIOR-03]` 覆盖 |
| INV-02 | "禁止硬编码 webhook URL" 技术约束；vitest 单测 `[BEHAVIOR-04]` 覆盖 |
| INV-03 | "去重机制" 章节；vitest 单测 `[BEHAVIOR-01]`、`[BEHAVIOR-02]` 覆盖 |
| INV-04 | "smoke 进 baseline" — `smoke-baseline.txt` 追加 `agent-offline-alert-smoke.sh` |
| INV-05 | "新 `.test.ts` 登记 registry" — `docs/registry/features/` 补录 |
| INV-06 | TDD 顺序：commit-1 = 本 sprint 的 failing smoke + failing test；commit-2 = 实现 |
| INV-07 | "告警 payload 格式" 章节；smoke E2E 断言覆盖 |
