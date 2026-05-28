# Sprint Contract Draft (Round 2)

## GAN Revision 说明（回应 Reviewer Round 1 反馈）

| 问题 | Reviewer 指摘 | Round 2 修正 |
|---|---|---|
| **#1 test_is_red/scope** | WS2 核心行为（ffprobe+PATCH）已在 L296-359 全实现，tests 即 GREEN；createJob 返回 flat，PRD 要 .job 嵌套 | 重划 WS1 范围：updateProgress→{ok:true} **+** getJob→{job:{...}} 包装；WS2 补测 spec 用 `jobResp.job.detected_aspect` 访问（适配新 getJob 形状） |
| **#2 internal_consistency** | agent=1.1.31，GHA=1.1.30，合同目标 1.1.29 = 降级 | Step 8/WS3 目标版本统一为 1.1.31 |
| **#3 verification_oracle_completeness** | GET endpoint PRD schema（{job:{...}}+禁 detectedAspect）无 jq-e oracle | WS1 DoD 新增 BEHAVIOR 5/6：静态代码断言 getJob 响应结构 + snake_case key |

---

## Golden Path

[用户打开 LocalVideoPipelinePage] → [选 W-G 模板 + 9:16 画幅] → [提交 createJob → {job:{...}} 响应] → [Agent ffprobe 检测画幅 + PATCH detected_aspect → {ok:true}] → [GET 返回 {job:{detected_aspect:"9:16"}}（.job 包装，snake_case）] → [E2E Playwright 全链路通过] → [GHA default version = 1.1.31]

---

### Step 1: DB migration 含 target_aspect + detected_aspect 两列（已完成）
**来源**: `[FROM_PRD]` — PRD "DB migration... target_aspect TEXT / detected_aspect TEXT"（WS1 PR #501 已合并）

**可观测行为**: `20260527_100000_add_original_script_to_video_jobs.sql` 含两列 ALTER。

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

**可观测行为**: `getJob` 函数当前返回 `res.json({...job, detected_aspect:null})`（flat spread）。需改为 `res.json({ job: { id, status, detected_aspect } })`。

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

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 的 `default:` 等于 `services/agent/package.json` 的 `version`（当前均应为 1.1.31）。

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

## Workstreams

workstream_count: 3

### Workstream 1: PATCH {ok:true} + GET {job:{...}} 响应格式修正（1 文件，S）

**范围**: `apps/api/src/controllers/ai-video-pipeline.controller.ts`：
- `updateProgress`：末尾 `res.json(updated)` → `res.json({ ok: true })`
- `getJob`：`res.json({...job, detected_aspect:...})` → `res.json({ job: { id: job.id, status: job.status, detected_aspect: job.detected_aspect ?? null } })`

**大小**: S（≤25 行净增，1 文件）
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

- 整体净增：WS1≈20 + WS2≈65 + WS3≈5 = ~90 行 < 200 行阈值
- 每 WS ≤ 1 文件，远低于 3 文件上限
- 串行链：ws1→[]，ws2→[ws1]，ws3→[ws2]（符合 depends_on 规则）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/patch-ok.test.ts` | updateProgress {ok:true}；keys==["ok"]；禁用字段检查；404 error path；getJob {job:{...}} wrapper；getJob .job 含 detected_aspect | 4 failures（updateProgress 当前返回 res.json(updated)；getJob 无 .job 包装） |
| WS2 | `tests/ws2/e2e-spec.test.ts` | spec 含 W-G click；9:16 在提交前；strict toMatch；无 null-accepting 断言；.job.detected_aspect 访问路径 | 5 failures（spec 缺 W-G/9:16 click；含 null；用 flat .detected_aspect） |
| WS3 | `tests/ws3/gha-version.test.ts` | GHA default == agent version；default 为 1.1.31；default 不是 1.1.30；workflow 含必要字段 | 3 failures（当前 GHA=1.1.30 ≠ agent=1.1.31） |
