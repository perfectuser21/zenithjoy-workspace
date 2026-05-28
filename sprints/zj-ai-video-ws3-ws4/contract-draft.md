# Sprint Contract Draft (Round 3)

## GAN Revision 说明（回应 Reviewer 历轮反馈）

| 轮次 | 问题 | Reviewer 指摘 | 修正 |
|---|---|---|---|
| R1→R2 | **#1 test_is_red/scope** | WS2 核心行为已全实现；createJob 返回 flat，PRD 要 .job 嵌套 | 重划 WS1：updateProgress→{ok:true} + getJob→{job:{...}} 包装；WS2 spec 改用 `.job.detected_aspect` |
| R1→R2 | **#2 internal_consistency** | agent=1.1.31，GHA=1.1.30，合同目标 1.1.29=降级 | Step 8/WS3 目标统一为 1.1.31 |
| R1→R2 | **#3 verification_oracle_completeness** | GET schema 无 jq-e oracle | WS1 DoD 新增 BEHAVIOR 5/6：getJob 响应结构 + snake_case |
| R2→R3 | **BLOCK-1 scope+consistency** | LocalVideoPipelinePage.tsx（比例选择器UI）在 PRD 范围内，合同无 WS 覆盖也无已完成标记 | 新增 Step 1.5（UI 已完成，静态验证含 9:16/16:9 value）；WS1 范围扩展含 `pollStatus` 适配（防 flat-consumer 断裂，见 Risk 1） |
| R2→R3 | **BLOCK-2 risk** | 合同无 Risks 段；① getJob 包装变更破坏 flat-consumer；② E2E 非空断言在无 rotation metadata 时 CI 必败 | 新增 `## Risks` 段（2 条命名 risk + mitigation） |

---

## Golden Path

[用户打开 LocalVideoPipelinePage] → [比例选择器选 9:16 / W-G 模板] → [提交 createJob → {job:{...}} 响应] → [Agent ffprobe 检测画幅 + PATCH detected_aspect → {ok:true}] → [GET 返回 {job:{detected_aspect:"9:16"}}] → [E2E Playwright 全链路通过] → [GHA default version = 1.1.31]

---

### Step 1: DB migration 含 target_aspect + detected_aspect 两列（已完成）
**来源**: `[FROM_PRD]` — PRD "DB migration... target_aspect TEXT / detected_aspect TEXT"（WS1 PR #501 已合并）

**可观测行为**: migration SQL 文件含两列 ALTER。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/db/migrations/20260527_100000_add_original_script_to_video_jobs.sql', 'utf8');
if (!c.includes('target_aspect') || !c.includes('detected_aspect')) {
  console.error('FAIL: 列缺失'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，已合并无需本 sprint 改动

---

### Step 1.5: LocalVideoPipelinePage.tsx 比例选择器 UI（已完成）
**来源**: `[FROM_PRD]` — PRD "前端比例选择器" + 预期受影响文件 `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`；已在 WS1（PR #501）合并前实现

**可观测行为**: `LocalVideoPipelinePage.tsx` 含竖版 9:16 / 横版 16:9 / 自动检测（null）三项选择器 + `targetAspect` 状态变量 + `createJob` 携带 `target_aspect` 传参。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx', 'utf8');
if (!c.includes(\"'9:16'\")) { console.error('FAIL: 缺 9:16 选项'); process.exit(1); }
if (!c.includes(\"'16:9'\")) { console.error('FAIL: 缺 16:9 选项'); process.exit(1); }
if (!c.includes('targetAspect')) { console.error('FAIL: 缺 targetAspect 状态变量'); process.exit(1); }
if (!c.includes('target_aspect: targetAspect')) { console.error('FAIL: createJob 未传 target_aspect'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，已实现无需本 sprint 改动（WS1 仅需同步更新 `pollStatus` 以适配 getJob 新响应格式，见 Risk 1）

---

### Step 2: POST createJob 携带 target_aspect → 返回 `{job:{...}}` 包装（已完成）
**来源**: `[FROM_PRD]` — PRD "提交时携带 target_aspect"

**可观测行为**: `createJob` 响应 `{job:{id,status,target_aspect,detected_aspect}}`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function createJob');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 3000);
if (!fn.match(/res\.(status\(201\)\.)?json\(\s*\{\s*job\s*:/)) {
  console.error('FAIL: createJob 未返回 {job:{...}} 包装'); process.exit(1);
}
if (!fn.includes('target_aspect')) {
  console.error('FAIL: createJob 未处理 target_aspect'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，已实现无需修改

---

### Step 3: Agent ffprobe 画幅检测 + effectiveTarget 单文件生成（已完成）
**来源**: `[FROM_PRD]` — PRD "rotation=90°/270° 时 swap ... effectiveTarget 只生成单文件"

**可观测行为**: `video-pipeline.ts` L296-359 已含 detectedAspect + rotation swap + effectiveTarget + PATCH 写回。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'services/agent/src/handlers/video-pipeline.ts', 'utf8');
if (!c.includes('detectedAspect')) { process.exit(1); }
if (!c.includes('effectiveTarget')) { process.exit(1); }
if (!c.includes('detected_aspect')) { process.exit(1); }
const hasPatch = /fetch.*progress.*detected_aspect|detected_aspect.*PATCH/s.test(c);
if (!hasPatch) { console.error('FAIL: detected_aspect PATCH 写回不存在'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，已实现（L296-359）无需修改

---

### Step 4: PATCH /api/ai-video/jobs/:id/progress 返回 `{"ok": true}` ← **WS1**
**来源**: `[FROM_PRD]` — PRD "Success (HTTP 200): {\"ok\": true}"

**可观测行为**: `updateProgress` 函数最后返回 `res.json({ ok: true })`，当前错误地返回 `res.json(updated)` 全对象。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function updateProgress');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 2000);
if (!fn.match(/res\.json\(\s*\{\s*ok\s*:\s*true\s*\}\s*\)/)) {
  console.error('FAIL: updateProgress 未返回 {ok:true}，当前返回 res.json(updated)');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0；`updateProgress` 必须 `res.json({ ok: true })`

---

### Step 5: PATCH 响应不含禁用字段（aspectRatio/aspect/ratio/orientation）← **WS1 顺带验**
**来源**: `[FROM_PRD]` — PRD 禁用字段清单；`[AI_ADDED]` — 防 generator 用禁用字段名绕过 schema 检查

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function updateProgress');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 2000);
const banned = ['aspectRatio', '\"aspect\"', '\"ratio\"', '\"orientation\"'];
const found = banned.filter(k => fn.includes(k) && !fn.includes('// ' + k));
if (found.length) {
  console.error('FAIL: 禁用字段 ' + found.join(', ') + ' 出现在响应中');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 6: GET /api/ai-video/jobs/:id 返回 `{job:{...}}` 包装 + snake_case detected_aspect ← **WS1**
**来源**: `[FROM_PRD]` — PRD GET Schema `{\"job\": {\"id\": \"<uuid>\", \"detected_aspect\": \"9:16\", \"status\": \"completed\"}}`；禁用变体 `detectedAspect`

**可观测行为**: `getJob` 函数当前返回 `res.json({...job, detected_aspect:null})`（flat spread）。需改为 `res.json({ job: { id, status, progress, detected_aspect } })`（含 progress 供 pollStatus 使用，见 Risk 1）。

**验证命令**:
```bash
# BEHAVIOR 5: {job:{...}} 包装存在
node -e "
const c = require('fs').readFileSync(
  'apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const s = c.indexOf('async function getJob');
const e = c.indexOf('\nasync function ', s + 1);
const fn = c.slice(s, e > s ? e : s + 500);
if (!fn.match(/res\.json\(\s*\{\s*job\s*:/)) {
  console.error('FAIL: getJob 未用 {job:{...}} 包装，当前含 flat spread');
  process.exit(1);
}
if (fn.match(/\.\.\.(job|updated)/)) {
  console.error('FAIL: getJob 含 spread operator，未用命名包装');
  process.exit(1);
}
console.log('OK');
"

# BEHAVIOR 6: .job 块显式含 detected_aspect key（snake_case）
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
console.log('OK');
"
```

**硬阈值**: 两条命令均 exit 0

---

### Step 6.5: pollStatus 适配 getJob 新 {job:{...}} 格式 ← **WS1**（Risk 1 Mitigation）
**来源**: `[AI_ADDED]` — getJob 从 flat 改为 `{job:{...}}` 包装后，`LocalVideoPipelinePage.tsx` 的 `pollStatus` 做 `{ id, ...res.data }` 会变成 `{ id, job:{...} }` — `state.status` undefined，轮询永不停止。防止前端功能失效。

**可观测行为**: `pollStatus` 函数改为 `return { id, status: res.data.job.status, progress: res.data.job.progress ?? 0, error: res.data.job.error }`（通过 `res.data.job` 访问，不用 flat spread）。

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

### Step 7: E2E spec 含 W-G 模板选择 + 9:16 画幅 + `.job.detected_aspect` 非空强断言 ← **WS2**
**来源**: `[FROM_PRD]` — PRD "E2E spec 补充 original_script + W-G + 9:16 + detected_aspect 断言"；`[AI_ADDED]` — 适配 WS1 新 getJob 形状，spec 必须改用 `.job.detected_aspect` 访问路径

**可观测行为**: `e2e/agent-video-pipeline.spec.js` 含 W-G 模板选择 + 9:16 按钮点击 + `jobResp.job.detected_aspect`（适配新 getJob 形状）+ `toMatch(/^(9:16|16:9)$/)` 严格断言。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
if (!c.includes('W-G')) { console.error('FAIL: 缺 W-G 模板选择'); process.exit(1); }
const wgIdx = c.indexOf('W-G');
const surroundingCode = c.slice(Math.max(0, wgIdx - 200), wgIdx + 200);
if (!/click|locator|getByText/i.test(surroundingCode)) {
  console.error('FAIL: W-G 附近无点击交互'); process.exit(1);
}
if (!c.includes('9:16')) { console.error('FAIL: 缺 9:16'); process.exit(1); }
const aspectIdx = c.indexOf('9:16');
const submitIdx = c.indexOf('开始处理');
if (aspectIdx >= submitIdx) {
  console.error('FAIL: 9:16 选择在提交按钮之后'); process.exit(1);
}
if (!/jobResp\.job\.detected_aspect/.test(c)) {
  console.error('FAIL: spec 仍用 flat jobResp.detected_aspect，未适配新 getJob 形状'); process.exit(1);
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

### Step 8: GHA default version = 1.1.31 ← **WS3**
**来源**: `[FROM_PRD]` — PRD "GHA default version 改为 1.1.29"；`[AI_ADDED]` — PRD 写时 agent 为 1.1.29，实际已达 1.1.31；target 改为 1.1.31（当前 GHA=1.1.30，agent=1.1.31，存在漂移）

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 的 `default:` 等于 `services/agent/package.json` 的 `version`（均为 1.1.31）。

**验证命令**:
```bash
AGENT_VER=$(node -e "console.log(require('./services/agent/package.json').version)") && \
GHA_VER=$(grep -m1 'default:' .github/workflows/agent-e2e-video.yml \
  | sed 's/.*default: *"\([^"]*\)".*/\1/' | tr -d ' ') && \
echo "agent_ver=$AGENT_VER gha_ver=$GHA_VER" && \
[ "$AGENT_VER" = "$GHA_VER" ] || { echo "FAIL: GHA default=$GHA_VER != agent=$AGENT_VER"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0；GHA default == agent package.json version（均为 1.1.31）

---

## E2E 验收（final-e2e — windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud

> GHA `agent-e2e-video.yml` workflow_dispatch，在 windows-latest Runner 上下载 agent install pack 并运行 Playwright E2E。

此 sprint 的 final-e2e 触发现有 `agent-e2e-video.yml`，它会：
1. 下载 `zenithjoy-agent-v${agent_version}.tar.gz`（版本 1.1.31）
2. 安装依赖 + 下载测试视频
3. 启动 Agent（接 `https://autopilot.zenjoymedia.media`）
4. 运行 `npx playwright test e2e/agent-video-pipeline.spec.js`

**PASS 标准**：Playwright 测试通过，`jobResp.job.detected_aspect` 断言非空（`toMatch(/^(9:16|16:9)$/)`），GHA job exit 0

**FAIL 标准**：任何 step exit≠0 OR Playwright 失败 OR agent 15min 内超时

---

## Risks

### Risk 1: getJob 包装变更破坏 pollStatus flat-consumer

**描述**: WS1 将 `getJob` 响应从 flat `{ ...job, detected_aspect }` 改为 `{ job: { id, status, progress, detected_aspect } }`。`LocalVideoPipelinePage.tsx` 的 `pollStatus` 函数当前做 `return { id, ...res.data }`；改完后 `res.data` 是 `{ job: {...} }`，展开为 `{ id, job: {...} }`，`state.status` 变成 `undefined`，轮询条件 `state.status === 'completed'` 永不成立，进度轮询永不停止，UI 功能失效。

**Mitigation**: WS1 范围**同时**覆盖 `LocalVideoPipelinePage.tsx` 的 `pollStatus` 更新（Step 6.5）：`return { id, ...res.data }` → `return { id, status: res.data.job.status, progress: res.data.job.progress ?? 0, error: res.data.job.error }`。getJob 新格式含 `progress` 字段（PRD GET schema 未禁止，[AI_ADDED]，供 pollStatus 使用）。WS1 DoD BEHAVIOR 7 静态验证 `pollStatus` 已用 `res.data.job` 路径，WS2 BEHAVIOR 5 验 E2E spec 已用 `.job.detected_aspect`。双端同步修改，flat-consumer 断裂风险消除。

### Risk 2: E2E 非空断言在测试视频无 rotation metadata 时 CI 必败

**描述**: WS2 E2E spec 改用 `toMatch(/^(9:16|16:9)$/)` 严格断言（不接受 null）。若 COS 测试视频无 rotation metadata（exif/container 层缺 `rotate` 字段）或 ffprobe 调用失败，Agent 的 `detectedAspect` 为 `null`，PATCH 写入 `detected_aspect = null`，`jobResp.job.detected_aspect` 为 `null`，断言失败 → CI 必败。

**Mitigation**: (a) PRD ASSUMPTION 已声明"COS 测试视频（rotation=90° iPhone 竖拍）可用于 ffprobe 验证"（前置假设，不在本 sprint 范围验证）；(b) Agent 兜底逻辑 `effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"` 确保即使 `detectedAspect` 为 null 也能生成视频文件，仅 `detected_aspect` 断言会 FAIL（级联失败被隔离）；(c) 若 CI 报 `detected_aspect=null`，调查路径是 COS 测试视频 URL 不可达或缺 rotation 流 → 换用含 rotation 元数据的测试视频，断言逻辑本身不需要改。

---

## Workstreams

workstream_count: 3

### Workstream 1: PATCH {ok:true} + GET {job:{...}} 响应格式修正 + pollStatus 适配（2 文件，S）

**范围**:
- `apps/api/src/controllers/ai-video-pipeline.controller.ts`：
  - `updateProgress`：`res.json(updated)` → `res.json({ ok: true })`
  - `getJob`：`res.json({...job, detected_aspect:...})` → `res.json({ job: { id: job.id, status: job.status, progress: job.progress ?? 0, detected_aspect: job.detected_aspect ?? null } })`（含 progress，供 pollStatus 使用）
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`：
  - `pollStatus`：`return { id, ...res.data }` → `return { id, status: res.data.job.status, progress: res.data.job.progress ?? 0, error: res.data.job.error }`

**大小**: S（≤35 行净增，2 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/patch-ok.test.ts`

---

### Workstream 2: E2E spec 适配 {job:{...}} + W-G + 9:16 + 非空强断言（1 文件，M）

**范围**: `e2e/agent-video-pipeline.spec.js`：
- step 3 后加 W-G 模板点击 + 9:16 画幅按钮点击
- 所有 `jobResp.detected_aspect` → `jobResp.job.detected_aspect`（适配 WS1 新 getJob 形状）
- `expect(['9:16', '16:9', null]).toContain(...)` → `expect(jobResp.job.detected_aspect).toMatch(/^(9:16|16:9)$/)`

**大小**: M（~65 行净增，1 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/e2e-spec.test.ts`

---

### Workstream 3: GHA workflow default version → 1.1.31（1 文件，S）

**范围**: `.github/workflows/agent-e2e-video.yml` 的 `agent_version` input `default:` 从 `"1.1.30"` 改为 `"1.1.31"`

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
| WS1 | `tests/ws1/patch-ok.test.ts` | updateProgress {ok:true}；keys==["ok"]；禁用字段；404 error path；getJob {job:{...}} wrapper；getJob .job 含 detected_aspect；pollStatus 用 res.data.job 路径 | 7 failures（updateProgress 返 res.json(updated)；getJob flat spread；pollStatus flat res.data） |
| WS2 | `tests/ws2/e2e-spec.test.ts` | spec 含 W-G click；9:16 在提交前；strict toMatch；无 null-accepting 断言；.job.detected_aspect 访问路径 | 5 failures（spec 缺 W-G/9:16 click；含 null；用 flat .detected_aspect） |
| WS3 | `tests/ws3/gha-version.test.ts` | GHA default == agent version；default 为 1.1.31；default 不是 1.1.30；workflow 含必要字段 | 3 failures（当前 GHA=1.1.30 ≠ agent=1.1.31） |
