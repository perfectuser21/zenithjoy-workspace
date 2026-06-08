# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: api_registry 不可用，基于 PRD 字面 + 现有测试文件推导）

### CLI: node build-modules/line04/preflight.js（stdout 最后一行）
**Success (exit 0 — 非 Windows 或 MOCK 版本 ≤4.1.8)**:
```json
{"ok": true, "checks": {"wechat_version": true, "pywinauto": true, "memory": true}}
```
- `ok` (boolean, 必填): 三项全通为 true；来源——PRD 场景A Step 3
- `checks` (object, 必填): 各检测项键值对；来源——`preflight.ts` ModulePreflightResult 接口
- `fixGuide` (string, **禁止出现**): ok:true 时不得存在此字段

**Failure (exit 1 — MOCK_WECHAT_VERSION=4.2.0.0 或真机微信版本不支持)**:
```json
{"ok": false, "checks": {"wechat_version": false, "pywinauto": true, "memory": true}, "fixGuide": "微信版本 4.2.0.0 不支持（需 ≤4.1.8）。请从此处下载旧版：https://...WeChatWin_4.1.8.exe"}
```
- `ok` (boolean, 必填): false
- `checks` (object, 必填): 各项结果
- `fixGuide` (string, 必填，ok:false 时): 人类可读修复指引，含 COS 下载 URL
- `reason` (string, 可选): 机器可读原因码

**禁用字段名**: `skipped`（内部 CheckOutcome 字段，不出现在顶层 preflight 输出中）

### Endpoint: GET /api/agent/module-health（已存在，smoke 脚本验证）
**Success (HTTP 200)**:
```json
{"ok": true, "data": [{"agent_id": "<uuid>", "hostname": "<string>", "module_status": {}, "updated_at": "<iso8601>"}]}
```
- `ok` (boolean, 必填): 固定 true；来源——apps/api/src/routes/walking-skeleton.ts
- `data` (array, 必填): 机器模块状态矩阵；来源——heartbeat-modules.test.ts
- `data[].agent_id` (string, 必填): 机器 UUID
- `data[].hostname` (string, 必填): 机器名
- `data[].module_status` (object, 必填): 各 Line 的 {ok, reason} 报告
- `data[].updated_at` (string, 必填): ISO8601 时间戳

**Error (HTTP 500)**:
```json
{"ok": false, "code": "MODULE_HEALTH_FAILED", "message": "<string>"}
```

---

## Golden Path

**主线（windows_cloud CI）**:
[CI 触发] → [npm ci + build] → [preflight 非 Windows exit 0] → [ModuleManager syncModules mock 验证] → [MOCK 高版本 exit 1 + fixGuide]

**xian-rog（自托管 runner）**:
[真机 preflight 三项检测] → [全通 exit 0] → [MOCK 高版本 exit 1]

---

### Step 1: 心跳响应含 modules 字段，4 个 Line 均含 status + required_version
**来源**: `[FROM_PRD]` — PRD 场景A Step 1："POST /api/agent/heartbeat 响应含 `modules: {line04-wechat-cs: {status:'active', required_version:'...'}}`（4 个 Line 全有）"

**可观测行为**: 心跳 POST 响应 JSON 含 `modules.line04-wechat-cs.status == "active"`，`required_version` 为字符串，4 个 Line 全有

**验证命令**（smoke 脚本用，需本地 API 可用）:
```bash
RESP=$(curl -sf -X POST "${API_BASE:-localhost:3000}/api/agent/heartbeat" \
  -H "Content-Type: application/json" \
  -d '{"license":"'"${TEST_LICENSE}"'","version":"1.0.0","hostname":"ci-smoke"}') || { echo "FAIL: heartbeat 非 200"; exit 1; }
echo "$RESP" | jq -e '.modules["line04-wechat-cs"].status == "active"' || { echo "FAIL: line04 status 非 active"; exit 1; }
echo "$RESP" | jq -e '.modules["line04-wechat-cs"].required_version | type == "string"' || { echo "FAIL: required_version 缺失"; exit 1; }
echo "$RESP" | jq -e '[.modules | keys] | flatten | length >= 4' || { echo "FAIL: modules 少于 4 个 Line"; exit 1; }
echo "Step 1 OK"
```

**硬阈值**: 4 个 Line 全有，每个含 `status:"active"` + `required_version`

---

### Step 2: ModuleManager.syncModules 检测未安装版本 → 触发 downloadModule
**来源**: `[FROM_PRD]` — PRD 场景A Step 2："ModuleManager.syncModules 收到 active module → 触发 downloadModule（CI 用 mock COS）"

**可观测行为**: `syncModules({'line04-wechat-cs': {status:'active', required_version:'1.0.0'}})` 时，`downloadImpl` 被调用恰好 1 次（版本未安装时）

**验证命令**:
```bash
cd services/agent && npm ci --prefer-offline 2>/dev/null | tail -1
npx tsx -e "
import { ModuleManager } from './src/module-manager.js';
import fs from 'node:fs'; import os from 'node:os';
const root = fs.mkdtempSync(os.tmpdir() + '/zj-smoke-');
let called = 0;
const mm = new ModuleManager({
  modulesRoot: root,
  downloadImpl: async () => { called++; },
  preflightImpl: async () => ({ ok: false, reason: 'smoke-skip' }),
});
await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });
fs.rmSync(root, { recursive: true, force: true });
if (called !== 1) { console.error('FAIL: downloadImpl called', called, 'times (expected 1)'); process.exit(1); }
console.log('Step 2 OK: downloadImpl called once');
" 2>&1 || exit 1
```

**硬阈值**: `downloadImpl` 恰好被调用 1 次

---

### Step 3: preflight.js 输出合法 JSON，非 Windows exit 0，schema 含 ok + checks
**来源**: `[FROM_PRD]` — PRD 场景A Step 3："`node modules/line04/preflight.js` 输出合法 JSON，非 Windows 跳过（exit 0）"

**可观测行为**: 在 Linux/Mac CI 上，`npx tsx modules/line04/preflight.ts` stdout 最后一行是合法 JSON，`ok:true`，含 `checks` 字段，不含 `fixGuide`，exit 0

**验证命令**:
```bash
cd services/agent
OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null)
echo "$OUT" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true（非 Windows 应跳过 = true）"; exit 1; }
echo "$OUT" | jq -e 'has("checks")' || { echo "FAIL: 缺 checks 字段"; exit 1; }
echo "$OUT" | jq -e 'has("fixGuide") | not' || { echo "FAIL: ok:true 时不应有 fixGuide"; exit 1; }
echo "Step 3 OK"
```

**硬阈值**: exit 0，`ok == true`，有 `checks`，无 `fixGuide`

---

### Step 4: activateModule fork index.js → 10s 内收到 {type:'ready'}，模块进入 active 列表
**来源**: `[FROM_PRD]` — PRD 场景A Step 4："activateModule fork `index.js` → 10s 内收到 `{type:'ready'}`"

**可观测行为**: ModuleManager.activateModule 用 forkImpl mock 验证：发送 {type:'config'}，收到 {type:'ready'} 后 getActiveModules() 含 lineId

**验证命令**:
```bash
cd services/agent
npx tsx -e "
import { ModuleManager } from './src/module-manager.js';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { EventEmitter } from 'node:events';
const root = fs.mkdtempSync(os.tmpdir() + '/zj-fork-');
const modDir = path.join(root, 'line04-wechat-cs-1.0.0');
fs.mkdirSync(modDir, { recursive: true });
fs.writeFileSync(path.join(modDir, 'manifest.json'), JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.0', entry: 'index.js' }));
let sentConfig = false;
const fakeChild = new EventEmitter() as any;
fakeChild.send = (m: any) => { if (m?.type === 'config') sentConfig = true; };
const mm = new ModuleManager({ modulesRoot: root, forkImpl: () => fakeChild });
const activatePromise = mm.activateModule('line04-wechat-cs');
setTimeout(() => fakeChild.emit('message', { type: 'ready' }), 50);
await activatePromise;
fs.rmSync(root, { recursive: true, force: true });
if (!sentConfig) { console.error('FAIL: config 消息未发送'); process.exit(1); }
if (!mm.getActiveModules().includes('line04-wechat-cs')) { console.error('FAIL: 模块未进入 active 列表'); process.exit(1); }
console.log('Step 4 OK: fork+config+active 链路验证通过');
" 2>&1 || exit 1
```

**硬阈值**: forkImpl 被调用，{type:'config'} 被发送，getActiveModules() 含 'line04-wechat-cs'

---

### Step 5: module_status 心跳上报 → DB 持久化 → GET /api/agent/module-health 可读
**来源**: `[FROM_PRD]` — PRD 场景A Step 5："带 `module_status:{line04-wechat-cs:{ok:true}}` 的心跳上报 → DB 持久化 → `GET /api/agent/module-health` 返回该记录"

**可观测行为**: POST heartbeat 携带 module_status 后，GET /api/agent/module-health 返回含该记录的 `{ok:true, data:[...]}`

**验证命令**（smoke 脚本中，需本地 API）:
```bash
# 上报 module_status
curl -sf -X POST "${API_BASE:-localhost:3000}/api/agent/heartbeat" \
  -H "Content-Type: application/json" \
  -d '{"license":"'"${TEST_LICENSE}"'","version":"1.0.0","hostname":"ci-smoke","module_status":{"line04-wechat-cs":{"ok":true}}}' \
  | jq -e '.ok == true' || { echo "FAIL: module_status 上报失败"; exit 1; }

# 查 module-health 矩阵
HEALTH=$(curl -sf "${API_BASE:-localhost:3000}/api/agent/module-health" \
  -H "Authorization: Bearer ${TEST_LICENSE}") || { echo "FAIL: module-health 非 200"; exit 1; }
echo "$HEALTH" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }
echo "$HEALTH" | jq -e '.data | type == "array"' || { echo "FAIL: data 非数组"; exit 1; }
echo "Step 5 OK"
```

**硬阈值**: GET /api/agent/module-health 返回 `{ok:true, data:[...]}` 数组

---

### Step 6: MOCK_WECHAT_VERSION=4.2.0.0 → preflight exit 1 + ok:false + fixGuide 含 COS URL
**来源**: `[FROM_PRD]` — PRD 场景B Step 2："MOCK_WECHAT_VERSION=4.2.0.0 注入 → preflight exit 1，JSON 含 fixGuide（含 WeChatWin_4.1.8.exe COS URL）"

**可观测行为**: 任何平台上注入 `MOCK_WECHAT_VERSION=4.2.0.0` 时，preflight 输出 `ok:false` + `fixGuide` 含 COS URL，exit code = 1（不跳过非 Windows 平台检查）

**验证命令**:
```bash
cd services/agent
MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-mock.json 2>/dev/null
PCODE=$?
[ "$PCODE" -eq 1 ] || { echo "FAIL: exit code $PCODE != 1（MOCK 高版本应 exit 1）"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.ok == false' || { echo "FAIL: MOCK 未触发 ok:false"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.fixGuide | type == "string"' || { echo "FAIL: 缺 fixGuide 字段"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.fixGuide | contains("WeChatWin_4.1.8.exe")' || { echo "FAIL: fixGuide 缺 COS URL"; exit 1; }
echo "Step 6 OK"
```

**硬阈值**: exit 1，`ok:false`，`fixGuide` 非空且含 `WeChatWin_4.1.8.exe`

---

### Step 7: CI workflow 文件结构正确（windows-latest job + wechat-capable xian-rog job）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：验证 Generator 真实创建了 CI 文件且包含正确的两个 runner 声明；缺少任一 runner 表示 CI 验证覆盖不完整

**可观测行为**: `.github/workflows/agent-module-e2e.yml` 存在，含 `windows-latest` 和 `wechat-capable` 两个 runner 声明；`agent-module-e2e-smoke.sh` 存在且含实质 `curl` 命令

**验证命令**:
```bash
# workflow 结构
grep -q "windows-latest" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 windows-latest job"; exit 1; }
grep -q "wechat-capable" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 xian-rog wechat-capable runner"; exit 1; }

# smoke 脚本非占位
REAL_LINES=$(grep -v '^#' .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh | grep -v '^[[:space:]]*$' | wc -l)
[ "$REAL_LINES" -ge 5 ] || { echo "FAIL: smoke 脚本实质内容不足 5 行（当前 $REAL_LINES 行）"; exit 1; }
grep -q "curl" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh || { echo "FAIL: smoke 脚本无 curl 调用"; exit 1; }
echo "Step 7 OK"
```

**硬阈值**: workflow 含两个正确 runner；smoke 脚本 ≥5 行实质内容且含 `curl`

---

## E2E 验收（Final E2E — windows_cloud）

**journey_type**: agent_remote
**target_environment**: windows_cloud（两 job：windows-latest + xian-rog self-hosted）

> **windows_cloud 用户路径 1:1 映射说明**：`agent-module-e2e.yml` 为本 sprint 新建文件，Proposer 按 PRD 设计内容如下。evaluator 模式B 验收通过 = workflow 两个 job 均绿。

### Job 1: module-e2e-windows（windows-latest，无真实微信）

| 用户步骤 | workflow step 映射 | 状态 |
|---|---|---|
| npm ci + build | `npm ci` + `npm run build` in services/agent | 待 Generator 写入 |
| ModuleManager syncModules mock 验证 | `npx tsx` 内联脚本 | 待 Generator 写入 |
| preflight 非 Windows exit 0 | `npx tsx modules/line04/preflight.ts` | 待 Generator 写入 |
| MOCK_WECHAT_VERSION=4.2.0.0 exit 1 | `MOCK_WECHAT_VERSION=4.2.0.0 npx tsx ...` | 待 Generator 写入 |

### Job 2: preflight-xian-rog（self-hosted, wechat-capable）

| 用户步骤 | workflow step 映射 | 状态 |
|---|---|---|
| 真机三项检测全通 exit 0 | `node build-modules/line04/preflight.js` | 类似 agent-preflight-e2e.yml 已有逻辑 |
| MOCK 高版本 exit 1 | `MOCK_WECHAT_VERSION=4.2.0.0 node ...` | 待 Generator 写入 |

**PASS 标准**: `agent-module-e2e.yml` 两个 job 均 exit 0
**FAIL 标准**: 任意 job exit≠0 OR timeout 15min
**GHA workflow**: `.github/workflows/agent-module-e2e.yml`（`workflow_dispatch` + push cp-*/main）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| preflight MOCK_WECHAT_VERSION 跨平台支持 | `tests/agent-module-e2e.test.ts` | MOCK=4.2.0.0 → ok:false + fixGuide | 2 failures（checkWechatVersion 现在非 Windows 忽略 MOCK env，返回 ok:true） |
