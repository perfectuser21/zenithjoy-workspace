# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: api_registry 不可用，基于 PRD 字面 + 现有代码推导）

> Round 2 改动：补充 `skipped` 反向检查 oracle 要求；补充 `data[0].module_status` 子字段 oracle；明确两 job 调用路径。

### CLI: node build-modules/line04/preflight.js（stdout 最后一行）
**Success (exit 0 — 非 Windows 或 MOCK 版本 ≤4.1.8)**:
```json
{"ok": true, "checks": {"wechat_version": true, "pywinauto": true, "memory": true}}
```
- `ok` (boolean, 必填): 三项全通为 true；来源——PRD 场景A Step 3
- `checks` (object, 必填): 各检测项键值对；来源——`preflight.ts` ModulePreflightResult 接口
- `fixGuide` (string, **禁止出现**): ok:true 时不得存在此字段
- `skipped` (**严禁出现在顶层输出**): CheckOutcome 内部字段，`runPreflight()` 的 ModulePreflightResult 不含此字段；必须加 `has("skipped") | not` 反向 oracle

**Failure (exit 1 — MOCK_WECHAT_VERSION=4.2.0.0 或真机微信版本不支持)**:
```json
{"ok": false, "checks": {"wechat_version": false, "pywinauto": true, "memory": true}, "fixGuide": "微信版本 4.2.0.0 不支持（需 ≤4.1.8）。请从此处下载旧版：https://...WeChatWin_4.1.8.exe"}
```
- `ok` (boolean, 必填): false
- `checks` (object, 必填): 各项结果
- `fixGuide` (string, 必填，ok:false 时): 含 COS 下载 URL
- `skipped` (**严禁出现在顶层输出**)

**禁用字段名**: `skipped`（内部 CheckOutcome 字段，不出现在顶层 preflight 输出中）

### Endpoint: GET /api/agent/module-health（已存在，smoke 脚本验证）
**Success (HTTP 200)**:
```json
{"ok": true, "data": [{"agent_id": "<uuid>", "hostname": "<string>", "module_status": {"line04-wechat-cs": {"ok": true}}, "updated_at": "<iso8601>"}]}
```
- `ok` (boolean, 必填): 固定 true；来源——walking-skeleton.ts L143
- `data` (array, 必填): 机器模块状态矩阵
- `data[].agent_id` (string, 必填): 机器 UUID
- `data[].hostname` (string, 必填): 机器名
- `data[].module_status` (object, 必填): `{"line04-wechat-cs": {"ok": true}}` — heartbeat 上报后必须在此字段可读
- `data[].updated_at` (string, 必填): ISO8601 时间戳

**oracle 要求（Round 2 新增）**:
- `jq -e '.data | length >= 1'`（上报后不应为空）
- `jq -e '.data[0].agent_id | type == "string"'`
- `jq -e '.data[0].module_status["line04-wechat-cs"].ok == true'`（heartbeat 写入后可读）

**Error (HTTP 500)**:
```json
{"ok": false, "code": "MODULE_HEALTH_FAILED", "message": "<string>"}
```

---

## Golden Path

**主线（windows_cloud CI）**:
[CI 触发] → [npm ci（无 build）] → [preflight 非 Windows exit 0 + skipped 反向检查] → [syncModules mock 验证 downloadImpl] → [activateModule+getActiveModules] → [MOCK 高版本 exit 1 + fixGuide]

**xian-rog（自托管 runner）**:
[触发] → [npm ci + `npm run build`] → [node dist/modules/line04/preflight.js 真机三项检测] → [全通 exit 0] → [MOCK 高版本 exit 1]

> **两 job 路径说明（Round 2 明确）**：
> - windows-latest job：**不执行 `npm run build`**，用 `npx tsx modules/line04/preflight.ts` 直接运行 TypeScript 源码（更快，避免编译 + 链路短）
> - xian-rog job：**必须先 `npm run build`**，再用 `node dist/modules/line04/preflight.js`（真机需编译产物）
> - DoD BEHAVIOR 命令由 evaluator 在本机执行，统一用 `npx tsx`（与 windows-latest job 保持一致）

---

### Step 1: 心跳响应含 modules 字段，4 个 Line 均含 status + required_version
**来源**: `[FROM_PRD]` — PRD 场景A Step 1："POST /api/agent/heartbeat 响应含 `modules: {line04-wechat-cs: {status:'active', required_version:'...'}}`（4 个 Line 全有）"

**可观测行为**: 心跳 POST 响应 JSON 含 `modules.line04-wechat-cs.status == "active"`，`required_version` 为字符串，4 个 Line 全有

**验证命令**（smoke 脚本 Steps 1/5 需 API 可用；guard 见 E2E 验收段 smoke.sh 模板）:
```bash
# API 可用性前置检查（smoke 脚本开头加 guard，Steps 1/5 仅在 API_UP=1 时执行）
API_UP=0
curl -sf "${API_BASE:-http://localhost:3000}/api/agent/health" > /dev/null 2>&1 && API_UP=1
if [ "$API_UP" -eq 0 ]; then
  echo "SKIP Step 1: API 未启动（设 API_BASE 或 workflow 加 API startup step）"
else
  RESP=$(curl -sf -X POST "${API_BASE:-http://localhost:3000}/api/agent/heartbeat" \
    -H "Content-Type: application/json" \
    -d '{"license":"'"${TEST_LICENSE}"'","version":"1.0.0","hostname":"ci-smoke"}') || { echo "FAIL: heartbeat 非 200"; exit 1; }
  echo "$RESP" | jq -e '.modules["line04-wechat-cs"].status == "active"' || { echo "FAIL: line04 status 非 active"; exit 1; }
  echo "$RESP" | jq -e '.modules["line04-wechat-cs"].required_version | type == "string"' || { echo "FAIL: required_version 缺失"; exit 1; }
  echo "$RESP" | jq -e '[.modules | keys] | flatten | length >= 4' || { echo "FAIL: modules 少于 4 个 Line"; exit 1; }
  echo "Step 1 OK"
fi
```

**硬阈值**: API 可用时：4 个 Line 全有，每个含 `status:"active"` + `required_version`

---

### Step 2: ModuleManager.syncModules 检测未安装版本 → 触发 downloadModule
**来源**: `[FROM_PRD]` — PRD 场景A Step 2："ModuleManager.syncModules 收到 active module → 触发 downloadModule"

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

### Step 3: preflight.js 输出合法 JSON，非 Windows exit 0，含 ok + checks，无 fixGuide，无 skipped
**来源**: `[FROM_PRD]` — PRD 场景A Step 3："`node modules/line04/preflight.js` 输出合法 JSON，非 Windows 跳过（exit 0）"

**可观测行为**: 在 Linux/Mac CI 上，`npx tsx modules/line04/preflight.ts` stdout 最后一行是合法 JSON，`ok:true`，含 `checks` 字段，不含 `fixGuide`，不含 `skipped`，exit 0

**验证命令**:
```bash
cd services/agent
OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null)
echo "$OUT" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true（非 Windows 应跳过 = true）"; exit 1; }
echo "$OUT" | jq -e 'has("checks")' || { echo "FAIL: 缺 checks 字段"; exit 1; }
echo "$OUT" | jq -e 'has("fixGuide") | not' || { echo "FAIL: ok:true 时不应有 fixGuide"; exit 1; }
echo "$OUT" | jq -e 'has("skipped") | not' || { echo "FAIL: 顶层输出不应含 skipped（CheckOutcome 内部字段）"; exit 1; }
echo "Step 3 OK"
```

**硬阈值**: exit 0，`ok == true`，有 `checks`，无 `fixGuide`，无 `skipped`

---

### Step 4: activateModule fork index.js → 10s 内收到 {type:'ready'}，模块进入 active 列表
**来源**: `[FROM_PRD]` — PRD 场景A Step 4："activateModule fork `index.js` → 10s 内收到 `{type:'ready'}`"

**可观测行为**: ModuleManager.activateModule 用 forkImpl mock 验证：发送 {type:'config'}，fakeChild emit {type:'ready'} 后 getActiveModules() 含 lineId

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
const fakeChild = new EventEmitter();
fakeChild.send = (m) => { if (m?.type === 'config') sentConfig = true; };
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

### Step 5: module_status 心跳上报 → DB 持久化 → GET /api/agent/module-health 返回子字段可验证记录
**来源**: `[FROM_PRD]` — PRD 场景A Step 5："带 `module_status:{line04-wechat-cs:{ok:true}}` 的心跳上报 → DB 持久化 → `GET /api/agent/module-health` 返回该记录"

**可观测行为**: POST heartbeat 携带 module_status 后，GET /api/agent/module-health 返回 `data[0].module_status["line04-wechat-cs"].ok == true`

**验证命令**（需 API 可用，smoke 脚本中 `API_UP` guard 控制）:
```bash
if [ "$API_UP" -eq 1 ]; then
  # 上报 module_status
  curl -sf -X POST "${API_BASE:-http://localhost:3000}/api/agent/heartbeat" \
    -H "Content-Type: application/json" \
    -d '{"license":"'"${TEST_LICENSE}"'","version":"1.0.0","hostname":"ci-smoke","module_status":{"line04-wechat-cs":{"ok":true}}}' \
    | jq -e '.ok == true' || { echo "FAIL: module_status 上报失败"; exit 1; }

  # 查 module-health 矩阵（全字段 oracle）
  HEALTH=$(curl -sf "${API_BASE:-http://localhost:3000}/api/agent/module-health" \
    -H "Authorization: Bearer ${TEST_LICENSE}") || { echo "FAIL: module-health 非 200"; exit 1; }
  echo "$HEALTH" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }
  echo "$HEALTH" | jq -e '.data | type == "array"' || { echo "FAIL: data 非数组"; exit 1; }
  echo "$HEALTH" | jq -e '.data | length >= 1' || { echo "FAIL: data 为空（heartbeat 未写入）"; exit 1; }
  echo "$HEALTH" | jq -e '.data[0].agent_id | type == "string"' || { echo "FAIL: data[0].agent_id 非 string"; exit 1; }
  echo "$HEALTH" | jq -e '.data[0].module_status["line04-wechat-cs"].ok == true' || { echo "FAIL: module_status 未持久化"; exit 1; }
  echo "Step 5 OK"
fi
```

**硬阈值**: `data | length >= 1`，`data[0].module_status["line04-wechat-cs"].ok == true`

---

### Step 6: MOCK_WECHAT_VERSION=4.2.0.0 → preflight exit 1 + ok:false + fixGuide 含 COS URL，无 skipped
**来源**: `[FROM_PRD]` — PRD 场景B Step 2："MOCK_WECHAT_VERSION=4.2.0.0 注入 → preflight exit 1，JSON 含 fixGuide（含 WeChatWin_4.1.8.exe COS URL）"

**可观测行为**: 任何平台注入 `MOCK_WECHAT_VERSION=4.2.0.0` 时，preflight 输出 `ok:false` + `fixGuide` 含 COS URL，exit code = 1

**验证命令**:
```bash
cd services/agent
MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-mock.json 2>/dev/null
PCODE=$?
[ "$PCODE" -eq 1 ] || { echo "FAIL: exit code $PCODE != 1（MOCK 高版本应 exit 1）"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.ok == false' || { echo "FAIL: MOCK 未触发 ok:false"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.fixGuide | type == "string"' || { echo "FAIL: fixGuide 非 string"; exit 1; }
cat /tmp/pf-mock.json | jq -e '.fixGuide | contains("WeChatWin_4.1.8.exe")' || { echo "FAIL: fixGuide 缺 COS URL"; exit 1; }
cat /tmp/pf-mock.json | jq -e 'has("skipped") | not' || { echo "FAIL: 顶层输出不应含 skipped"; exit 1; }
echo "Step 6 OK"
```

**硬阈值**: exit 1，`ok:false`，`fixGuide` 含 `WeChatWin_4.1.8.exe`，无 `skipped`

---

### Step 7: CI workflow 文件内容正确（两 runner + smoke 脚本被调用 + npx tsx 内联命令）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，Round 2 加强；理由：仅验 runner 标签不验 workflow 是否真正调用业务脚本，Generator 可写空 workflow 骗过标签检查

**可观测行为**: workflow 文件含 `windows-latest` + `wechat-capable` 两个 runner；**且**包含对 `agent-module-e2e-smoke.sh` 的调用；**且** windows-latest job 含 `npx tsx` 调用

**验证命令**:
```bash
# runner 声明
grep -q "windows-latest" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 windows-latest job"; exit 1; }
grep -q "wechat-capable" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 xian-rog wechat-capable runner"; exit 1; }
# workflow 真正调用 smoke 脚本（不是空文件）
grep -q "agent-module-e2e-smoke.sh" .github/workflows/agent-module-e2e.yml || { echo "FAIL: workflow 未调用 agent-module-e2e-smoke.sh"; exit 1; }
# windows-latest job 含 npx tsx 内联命令（验 Steps 2/4 非 placeholder）
grep -q "npx tsx" .github/workflows/agent-module-e2e.yml || { echo "FAIL: windows-latest job 缺 npx tsx 调用"; exit 1; }
# smoke 脚本非占位
REAL_LINES=$(grep -v '^#' .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh | grep -v '^[[:space:]]*$' | wc -l)
[ "$REAL_LINES" -ge 5 ] || { echo "FAIL: smoke 脚本实质内容不足 5 行（当前 $REAL_LINES 行）"; exit 1; }
grep -q "module-health" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh || { echo "FAIL: smoke 脚本未覆盖 module-health 端点"; exit 1; }
echo "Step 7 OK"
```

**硬阈值**: 两个 runner + smoke 脚本被调用 + npx tsx 存在 + smoke 含 module-health

---

## Risks（PRD 边界情况 + CI 风险）

| 风险 | 影响 | Mitigation |
|---|---|---|
| xian-rog self-hosted runner 离线或注册失效 | xian-rog job 永久挂起/跳过，不判红 | workflow 加 `timeout-minutes: 10`；离线时 job 状态为 skipped（不 block merge） |
| COS 模块包 `line04-wechat-cs-v1.0.0.tar.gz` 不存在 | `build-line-modules` CI 未上传，downloadModule 返回 404 | Step 2 用 mock downloadImpl（不走真实 COS），与 [ASSUMPTION] 一致；真实 COS 由 build-line-modules job 保证 |
| API 服务未启动（windows-latest 无 API startup step）| Steps 1/5 smoke 命令无法 curl | smoke 脚本开头加 `API_UP` guard：API 不可用时 Step 1/5 打印 SKIP，不 exit 1；workflow 注释说明设 `API_BASE` 环境变量指向已部署测试 API 可启用完整链路测试 |

---

## E2E 验收（Final E2E — windows_cloud + xian-rog 两 job）

**journey_type**: agent_remote
**target_environment**: windows_cloud（Job 1: windows-latest；Job 2: xian-rog self-hosted）

---

### Job 1: module-e2e-windows（windows-latest，无真实微信，npx tsx 直接运行源码）

| 用户步骤 | workflow step | 执行方式 |
|---|---|---|
| npm ci（不 build） | `npm ci --prefer-offline` in services/agent | windows-latest 自动 |
| ModuleManager syncModules mock 验证 | `npx tsx -e "..."` 内联 downloadImpl mock | windows-latest 内联 tsx |
| activateModule → getActiveModules | `npx tsx -e "..."` 内联 forkImpl mock | windows-latest 内联 tsx |
| preflight 非 Windows exit 0 + skipped 反向 | `npx tsx modules/line04/preflight.ts` | windows-latest tsx |
| MOCK_WECHAT_VERSION=4.2.0.0 exit 1 | `MOCK_WECHAT_VERSION=4.2.0.0 npx tsx ...` | windows-latest tsx |
| smoke 脚本（Steps 1/5 API_UP guard） | `bash .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh` | windows-latest bash |

### Job 2: preflight-xian-rog（self-hosted, wechat-capable，先 build 再 node）

| 用户步骤 | workflow step | 执行方式 |
|---|---|---|
| npm ci + npm run build | `npm ci` + `npm run build` | xian-rog bash |
| 真机三项检测全通 exit 0 | `node dist/modules/line04/preflight.js` | xian-rog node 编译产物 |
| MOCK 高版本 exit 1 | `MOCK_WECHAT_VERSION=4.2.0.0 node dist/modules/line04/preflight.js` | xian-rog node |

> **路径说明**：xian-rog 用 `node dist/modules/line04/preflight.js`（`npm run build` 后的编译产物），与 `agent-preflight-e2e.yml` 同模式。若 tsconfig outDir 不含 `modules/`，Generator 需确认正确输出路径。

**PASS 标准**: `agent-module-e2e.yml` 两个 job 均 exit 0
**FAIL 标准**: 任意 job exit≠0 OR timeout 15min（xian-rog job timeout-minutes: 10）
**GHA workflow**: `.github/workflows/agent-module-e2e.yml`（`workflow_dispatch` + push cp-*/main）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| preflight MOCK_WECHAT_VERSION 跨平台支持 | `tests/agent-module-e2e.test.ts` | MOCK=4.2.0.0 → ok:false + fixGuide；MOCK=4.1.8.0 → found=='4.1.8.0' | 2 failures（checkWechatVersion 现在非 Windows 忽略 MOCK env，返回 ok:true） |
