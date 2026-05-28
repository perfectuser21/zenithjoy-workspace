# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 LocalVideoPipelinePage 选 9:16 + W-G 模板] → [提交 createJob → `{job:{id,...}}`] → [Agent ffprobe 检测画幅 → PATCH `detected_aspect` → `{ok:true}`] → [GET 返回 `{job:{detected_aspect:"9:16",...}}`] → [E2E Playwright 全链路通过] → [GHA default version = 1.1.31]

---

### Step 1: DB migration 含 target_aspect + detected_aspect 两列（已完成）

**来源**: `[FROM_PRD]` — PRD "DB migration... target_aspect TEXT / detected_aspect TEXT"；实际位于 `apps/api/db/migrations/20260527_100000_add_original_script_to_video_jobs.sql`，PR #501 已合并

**可观测行为**: migration SQL 文件含 `target_aspect` 和 `detected_aspect` 两列定义。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/db/migrations/20260527_100000_add_original_script_to_video_jobs.sql', 'utf8');
if (!c.includes('target_aspect') || !c.includes('detected_aspect')) {
  console.error('FAIL: migration 缺列'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，已合并无需本 sprint 改动

---

### Step 2: 前端比例选择器 UI + createJob 携带 target_aspect（已完成）

**来源**: `[FROM_PRD]` — PRD "前端比例选择器呈现三项" + 预期受影响文件 `LocalVideoPipelinePage.tsx`；PR #501 已合并

**可观测行为**: `LocalVideoPipelinePage.tsx` 含 `targetAspect` 状态 + 三项选择器（null/9:16/16:9）+ `createJob` 携带 `target_aspect`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx', 'utf8');
if (!c.includes(\"'9:16'\")) { console.error('FAIL: 缺 9:16 选项'); process.exit(1); }
if (!c.includes(\"'16:9'\")) { console.error('FAIL: 缺 16:9 选项'); process.exit(1); }
if (!c.includes('targetAspect')) { console.error('FAIL: 缺 targetAspect 状态变量'); process.exit(1); }
if (!c.includes('target_aspect: targetAspect') && !c.includes('target_aspect:targetAspect')) {
  console.error('FAIL: createJob 未传 target_aspect'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，已实现无需本 sprint 改动

---

### Step 3: Agent ffprobe 画幅检测 + effectiveTarget 单文件生成（已完成）

**来源**: `[FROM_PRD]` — PRD "rotation=90°/270° 时 swap... effectiveTarget 只生成单文件"；已在 Agent `video-pipeline.ts` L296-359 实现

**可观测行为**: `video-pipeline.ts` 含 `detectedAspect` + rotation swap + `effectiveTarget` + PATCH `detected_aspect` 写回。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'services/agent/src/handlers/video-pipeline.ts', 'utf8');
if (!c.includes('detectedAspect')) { console.error('FAIL: 缺 detectedAspect'); process.exit(1); }
if (!c.includes('effectiveTarget')) { console.error('FAIL: 缺 effectiveTarget'); process.exit(1); }
if (!c.includes('detected_aspect')) { console.error('FAIL: 缺 detected_aspect PATCH'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，已实现无需本 sprint 改动

---

### Step 4: PATCH /api/ai-video-pipeline/:jobId/progress 返回 `{"ok": true}` ← **WS1**

**来源**: `[FROM_PRD]` — PRD PATCH Schema "Success (HTTP 200): `{\"ok\": true}`"

**可观测行为**: `updateProgress` 函数末尾返回 `res.json({ ok: true })`，当前错误地返回 `res.json(updated)`（全对象）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function updateProgress');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 2000);
if (!fn.match(/res\.json\(\s*\{\s*ok\s*:\s*true\s*\}\s*\)/)) {
  console.error('FAIL: updateProgress 仍返回 res.json(updated)，未改为 {ok:true}');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0；`updateProgress` 必须 `res.json({ ok: true })`

---

### Step 5: PATCH 响应 keys == `["ok"]` + 禁用字段不出现 ← **WS1**

**来源**: `[FROM_PRD]` — PRD PATCH Schema 禁用字段 `aspectRatio / aspect / ratio / orientation`；`[AI_ADDED]` — 防止 generator 用禁用字段名绕过 schema 检查

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function updateProgress');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 2000);
const match = fn.match(/res\.json\(\s*(\{[^}]+\})\s*\)/);
if (!match) { console.error('FAIL: 找不到 res.json 字面对象'); process.exit(1); }
const obj = match[1].replace(/\s/g, '');
if (obj !== '{ok:true}') { console.error('FAIL: 响应不是严格 {ok:true}，当前: ' + obj); process.exit(1); }
const banned = ['aspectRatio', '\"aspect\"', '\"ratio\"', '\"orientation\"'];
const found = banned.filter(k => fn.includes(k));
if (found.length) { console.error('FAIL: 禁用字段 ' + found + ' 出现'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 6: PATCH error path — 404 + error 字段未被破坏 ← **WS1**

**来源**: `[AI_ADDED]` — 修改 `updateProgress` 响应时不能意外删除 404 not-found 处理；防止 generator 过度简化函数体

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function updateProgress');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 2000);
if (!fn.includes('404') || !fn.includes('error')) {
  console.error('FAIL: updateProgress 缺少 404 error path');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 7: GET /api/ai-video-pipeline/:jobId 返回 `{job:{...}}` 包装 ← **WS1**

**来源**: `[FROM_PRD]` — PRD GET Schema `{"job": {"id": "<uuid>", "detected_aspect": "9:16", "status": "completed"}}`

**可观测行为**: `getJob` 函数当前返回 flat spread `{ ...job, detected_aspect }` → 需改为 `res.json({ job: { id, status, progress, detected_aspect } })`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function getJob');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 500);
if (!fn.match(/res\.json\(\s*\{\s*job\s*:/)) {
  console.error('FAIL: getJob 未用 {job:{...}} 包装，当前为 flat spread');
  process.exit(1);
}
if (fn.match(/\.\.\.(job|updated)/)) {
  console.error('FAIL: getJob 含 spread operator');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 8: GET .job 块含 detected_aspect（snake_case，禁 detectedAspect）← **WS1**

**来源**: `[FROM_PRD]` — PRD GET Schema 禁用 `detectedAspect`（响应必须 snake_case）

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function getJob');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 500);
if (!fn.match(/job\s*:\s*\{[\s\S]*?detected_aspect/)) {
  console.error('FAIL: getJob .job 块未含 detected_aspect key');
  process.exit(1);
}
if (fn.match(/detectedAspect\s*:/)) {
  console.error('FAIL: getJob 含禁用 camelCase key detectedAspect');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 9: pollStatus 适配 getJob 新 `{job:{...}}` 格式 ← **WS1**

**来源**: `[AI_ADDED]` — `getJob` 从 flat 改为 `{job:{...}}` 后，`LocalVideoPipelinePage.tsx` 的 `pollStatus` 函数当前做 `return { id, ...res.data }`，改后 `res.data = { job: {...} }` → 展开后 `state.status` 变成 `undefined` → 轮询永不停止。必须在同一 WS1 同步修复，防止前端功能失效。

**可观测行为**: `pollStatus` 改为通过 `res.data.job.status` 访问（不用 flat spread）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx', 'utf8');
const s = c.indexOf('async function pollStatus');
const e = c.indexOf('\nasync function', s + 1);
const fn = c.slice(s, e > s ? e : s + 300);
if (!fn.match(/res\.data\.job/)) {
  console.error('FAIL: pollStatus 仍用 flat res.data spread，未适配 {job:{...}} 格式');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 10: E2E spec 含 W-G 模板选择 + 9:16 画幅点击 + `.job.detected_aspect` 非空强断言 ← **WS2**

**来源**: `[FROM_PRD]` — PRD "E2E spec 补充 original_script + W-G + 9:16 + detected_aspect 断言"；`[AI_ADDED]` — WS1 改变 `getJob` 形状后，spec 必须适配 `jobResp.job.detected_aspect`（当前 flat `jobResp.detected_aspect` 会变成 `undefined`）

**可观测行为**: `e2e/agent-video-pipeline.spec.js` 含 W-G 模板点击 + 9:16 按钮点击（在"开始处理"前）+ `jobResp.job.detected_aspect` + `toMatch(/^(9:16|16:9)$/)` 严格断言（不含 null）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
if (!c.includes('W-G')) { console.error('FAIL: 缺 W-G'); process.exit(1); }
const wgIdx = c.indexOf('W-G');
const surrounding = c.slice(Math.max(0, wgIdx - 200), wgIdx + 200);
if (!/click|locator|getByText/i.test(surrounding)) {
  console.error('FAIL: W-G 附近无点击交互'); process.exit(1);
}
if (!c.includes('9:16')) { console.error('FAIL: 缺 9:16'); process.exit(1); }
const aspectIdx = c.indexOf('9:16');
const submitIdx = c.indexOf('开始处理');
if (aspectIdx >= submitIdx) {
  console.error('FAIL: 9:16 选择出现在提交之后'); process.exit(1);
}
if (!/jobResp\.job\.detected_aspect/.test(c)) {
  console.error('FAIL: spec 仍用 flat jobResp.detected_aspect，未适配 {job:{...}}'); process.exit(1);
}
const strictPattern = /toMatch\([^)]*9:16[^)]*16:9|toMatch.*\/(9:16\|16:9)|toBe\([^)]*9:16|toBe\([^)]*16:9/;
if (!strictPattern.test(c)) {
  console.error('FAIL: detected_aspect 断言仍允许 null'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 11: E2E spec 不含 null-accepting 宽松断言 ← **WS2**

**来源**: `[AI_ADDED]` — 防止 generator 仅改 access path 而不收紧断言；COS 测试视频含 rotation=90° iPhone 竖拍，`detectedAspect` 不应为 null

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
if (c.includes(\"'16:9', null\") || c.includes('\"16:9\", null') || c.includes('null].toContain')) {
  console.error('FAIL: spec 仍含允许 null 的宽松断言');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 12: GHA agent_version input default == agent package.json version ← **WS3**

**来源**: `[FROM_PRD]` — PRD "GHA default version 改为 1.1.29"（PRD 写作时 agent 为 1.1.28）；`[AI_ADDED]` — 实际 `services/agent/package.json` 已为 `1.1.31`，GHA `default: "1.1.30"` 落后一个版本；目标改为 `1.1.31` 而非 PRD 原写的 `1.1.29`（1.1.29 为降级）

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 的 `agent_version` input `default:` 等于 `services/agent/package.json` 的 `version`（均为 `1.1.31`）。

**验证命令**:
```bash
AGENT_VER=$(node -e "console.log(require('./services/agent/package.json').version)") && \
GHA_VER=$(grep -m1 'default:' .github/workflows/agent-e2e-video.yml \
  | sed 's/.*default: *"\([^"]*\)".*/\1/' | tr -d ' ') && \
echo "agent_ver=$AGENT_VER gha_ver=$GHA_VER" && \
[ "$AGENT_VER" = "$GHA_VER" ] || { echo "FAIL: GHA default=$GHA_VER != agent=$AGENT_VER"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0；GHA default == agent version（均为 1.1.31）

---

## E2E 验收（final-e2e — windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud

> GHA `agent-e2e-video.yml` workflow_dispatch，在 windows-latest Runner 上下载 agent install pack 并运行 Playwright E2E。

此 sprint 的 final-e2e 触发现有 `agent-e2e-video.yml`：
1. 下载 `zenithjoy-agent-v1.1.31.tar.gz`
2. 安装依赖 + 下载测试视频（rotation=90° iPhone 竖拍）
3. 启动 Agent（接 `https://autopilot.zenjoymedia.media`）
4. 运行 `npx playwright test e2e/agent-video-pipeline.spec.js`

**PASS 标准**：Playwright 测试通过，`jobResp.job.detected_aspect` 断言非空（`toMatch(/^(9:16|16:9)$/)`），GHA job exit 0

**FAIL 标准**：任何 step exit≠0 OR Playwright 失败 OR agent 15min 内超时

---

## Risks

### Risk 1: getJob 包装变更破坏 pollStatus flat-consumer

**描述**: WS1 将 `getJob` 响应从 flat `{ ...job, detected_aspect }` 改为 `{ job: { id, status, progress, detected_aspect } }`。`LocalVideoPipelinePage.tsx` 的 `pollStatus` 函数当前做 `return { id, ...res.data }`；改完后 `res.data = { job: {...} }`，展开为 `{ id, job: {...} }`，`state.status` 变 `undefined`，轮询永不停止，UI 功能失效。

**Mitigation**: WS1 范围**同时**覆盖 `pollStatus` 更新（Step 9）：`return { id, ...res.data }` → `return { id, status: res.data.job.status, progress: res.data.job.progress ?? 0, error: res.data.job.error }`。WS1 BEHAVIOR 7 静态验证 `pollStatus` 已改用 `res.data.job` 路径。

### Risk 2: E2E 非空断言在测试视频无 rotation metadata 时 CI 必败

**描述**: WS2 E2E spec 改用 `toMatch(/^(9:16|16:9)$/)` 严格断言（不接受 null）。若 COS 测试视频 ffprobe 失败，`detectedAspect = null`，断言 FAIL → CI 必败。

**Mitigation**: PRD ASSUMPTION 已声明"COS 测试视频（rotation=90° iPhone 竖拍）可用于 ffprobe 验证"。若 CI 报 `detected_aspect=null`，调查路径是 COS URL 不可达或缺 rotation 流，断言逻辑本身不需改。

---

## Workstreams

workstream_count: 3

### Workstream 1: PATCH `{ok:true}` + GET `{job:{...}}` 响应格式修正 + pollStatus 适配（2 文件，S）

**范围**:
- `apps/api/src/controllers/ai-video-pipeline.controller.ts`：
  - `updateProgress`：`res.json(updated)` → `res.json({ ok: true })`
  - `getJob`：flat `{ ...job, detected_aspect }` → `res.json({ job: { id: job.id, status: job.status, progress: job.progress ?? 0, detected_aspect: job.detected_aspect ?? null } })`
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`：
  - `pollStatus`：`return { id, ...res.data }` → `return { id, status: res.data.job.status, progress: res.data.job.progress ?? 0, error: res.data.job.error }`

**大小**: S（≤35 行净增，2 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/patch-ok.test.ts`

---

### Workstream 2: E2E spec 适配 `{job:{...}}` + W-G + 9:16 + 非空强断言（1 文件，M）

**范围**: `e2e/agent-video-pipeline.spec.js`：
- step 3 后加 W-G 模板点击 + 9:16 画幅按钮点击（在"开始处理"前）
- `jobResp.detected_aspect` → `jobResp.job.detected_aspect`（适配 WS1 新 getJob 形状）
- `expect(['9:16', '16:9', null]).toContain(...)` → `expect(jobResp.job.detected_aspect).toMatch(/^(9:16|16:9)$/)`

**大小**: M（~65 行净增，1 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/e2e-spec.test.ts`

---

### Workstream 3: GHA workflow default version → 1.1.31（1 文件，S）

**范围**: `.github/workflows/agent-e2e-video.yml` 的 `agent_version` input `default:` 从 `"1.1.30"` 改为 `"1.1.31"`（对齐 `services/agent/package.json` version=1.1.31）

**大小**: S（~3 行净增，1 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/gha-version.test.ts`

---

## Workstreams 切分确认

- 整体净增：WS1≈35 + WS2≈65 + WS3≈5 = ~105 行 < 200 行阈值
- WS1 2 文件，WS2/WS3 各 1 文件，均 ≤ 3 文件上限
- 串行链：ws1→[]，ws2→[ws1]，ws3→[ws2]（符合 depends_on 规则）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/patch-ok.test.ts` | updateProgress `{ok:true}`；keys==`["ok"]`；禁用字段；404 error path；getJob `{job:{...}}` wrapper；getJob .job 含 `detected_aspect`；pollStatus 用 `res.data.job` 路径 | 7 failures（updateProgress 返 `res.json(updated)`；getJob flat spread；pollStatus flat `res.data`） |
| WS2 | `tests/ws2/e2e-spec.test.ts` | spec 含 W-G click；9:16 在提交前；strict toMatch；无 null-accepting 断言；`.job.detected_aspect` 访问路径 | 5 failures（spec 缺 W-G/9:16 click；含 null；用 flat `.detected_aspect`） |
| WS3 | `tests/ws3/gha-version.test.ts` | GHA default == agent version；default 为 1.1.31；default 不是 1.1.30；workflow 含必要字段 | 3 failures（当前 GHA=1.1.30 ≠ agent=1.1.31） |
