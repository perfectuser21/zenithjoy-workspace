# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 LocalVideoPipelinePage] → [选 W-G 模板 + 9:16 画幅] → [提交 createJob] → [Agent ffprobe 检测画幅 + PATCH detected_aspect] → [PATCH 返回 `{"ok":true}`] → [GET 返回 detected_aspect 非空] → [E2E Playwright 全链路通过] → [GHA default 版本对齐]

---

### Step 1: DB 已有 target_aspect + detected_aspect 两列
**来源**: `[FROM_PRD]` — PRD 第 31-35 行 "DB migration... `target_aspect TEXT` / `detected_aspect TEXT`"

**可观测行为**: `zenithjoy.ai_video_pipeline_jobs` 表含两新列，migration 文件存在。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/db/migrations/20260527_100000_add_original_script_to_video_jobs.sql', 'utf8');
if (!c.includes('target_aspect') || !c.includes('detected_aspect')) { console.error('FAIL: 列缺失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，migration 文件含两列定义

---

### Step 2: POST createJob 携带 target_aspect
**来源**: `[FROM_PRD]` — PRD 第 19-20 行 "提交时携带 `target_aspect`（null 表示自动）"

**可观测行为**: createJob 控制器接受 `target_aspect`，插入 DB。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
if (!c.includes('target_aspect') || !c.includes('targetAspect')) { console.error('FAIL: target_aspect 未被 createJob 处理'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 3: Agent ffprobe 画幅检测 + PATCH detected_aspect 写回
**来源**: `[FROM_PRD]` — PRD 第 21-23 行 "rotation=90°/270° 时 swap ... PATCH progress 写回 `detected_aspect`"

**可观测行为**: `video-pipeline.ts` 含 `detectedAspect` 逻辑 + PATCH 写回，`effectiveTarget` 用 `target_aspect ?? detectedAspect` 回落链。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts', 'utf8');
if (!c.includes('detectedAspect')) { process.exit(1); }
if (!c.includes('effectiveTarget')) { process.exit(1); }
if (!c.includes('detected_aspect')) { process.exit(1); }
const hasPatch = /fetch.*progress.*detected_aspect|detected_aspect.*PATCH/s.test(c);
if (!hasPatch) { console.error('FAIL: detected_aspect PATCH 写回不存在'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 4: PATCH /api/ai-video/jobs/:id/progress 返回 `{"ok": true}`
**来源**: `[FROM_PRD]` — PRD 第 43-45 行 `Success (HTTP 200): {"ok": true}`

**可观测行为**: `updateProgress` 控制器响应 `res.json({ ok: true })`，而非全 job 对象。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const fnStart = c.indexOf('async function updateProgress');
const fnEnd   = c.indexOf('\nasync function ', fnStart + 1);
const fn = c.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
if (!fn.match(/res\.json\(\s*\{[\s\n]*ok\s*:\s*true[\s\n]*\}\s*\)/)) {
  console.error('FAIL: updateProgress 未返回 {ok:true}，当前返回全 job 对象');
  process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，updateProgress 必须 `res.json({ ok: true })`

---

### Step 5: PATCH 响应不含禁用字段
**来源**: `[FROM_PRD]` — PRD 第 47 行 "禁用响应字段名：aspectRatio / aspect / ratio / orientation"；`[AI_ADDED]` — 防止 generator 用禁用字段名绕过 schema 检查

**可观测行为**: `updateProgress` 返回 `{ok:true}` 时，禁用字段不存在。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const fnStart = c.indexOf('async function updateProgress');
const fnEnd   = c.indexOf('\nasync function ', fnStart + 1);
const fn = c.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
const banned = ['aspectRatio', 'aspect:', 'ratio:', 'orientation'];
const found = banned.filter(k => fn.includes(k) && !fn.includes('// ' + k));
if (found.length) { console.error('FAIL: 禁用字段 ' + found.join(', ') + ' 出现在响应中'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 6: GET /api/ai-video/jobs/:id 返回 detected_aspect（snake_case，非 camelCase）
**来源**: `[FROM_PRD]` — PRD 第 49-56 行 `"detected_aspect": "9:16"`, "禁用字段变体：`detectedAspect`"

**可观测行为**: `getJob` 响应含 `detected_aspect` 字段，不含 `detectedAspect`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');
const fnStart = c.indexOf('async function getJob');
const fnEnd   = c.indexOf('\nasync function ', fnStart + 1);
const fn = c.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1000);
if (!fn.includes('detected_aspect')) { console.error('FAIL: getJob 未返回 detected_aspect'); process.exit(1); }
if (fn.includes('detectedAspect') && !fn.includes('// detectedAspect') && fn.indexOf('detectedAspect') > fn.indexOf('detected_aspect')) {
  console.warn('WARN: getJob 可能用 camelCase');
}
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 7: E2E spec 含 W-G 模板选择 + 9:16 画幅 + detected_aspect 非空强断言
**来源**: `[FROM_PRD]` — PRD 第 27 行 "E2E spec 补充 original_script + W-G + 9:16 + detected_aspect 断言"

**可观测行为**: `e2e/agent-video-pipeline.spec.js` 含 W-G 模板选择代码 + 9:16 按钮点击 + `detected_aspect` 非空断言。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
if (!c.includes('W-G')) { console.error('FAIL: 缺 W-G 模板选择'); process.exit(1); }
if (!c.includes('9:16')) { console.error('FAIL: 缺 9:16 画幅选择'); process.exit(1); }
const hasNonNull = /detected_aspect.*!==.*null|expect.*detected_aspect.*match|toBe\('9:16'\)|toBe\('16:9'\)/s.test(c);
if (!hasNonNull) { console.error('FAIL: detected_aspect 断言不够严格（未排除 null）'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 8: GHA workflow default version 与 agent package.json 版本对齐
**来源**: `[FROM_PRD]` — PRD 第 27 行 "agent-e2e-video.yml default version 改为 1.1.29"；`[AI_ADDED]` — PRD 写时目标 1.1.29，实际 agent 已达 1.1.31，对齐当前实际版本防止版本漂移

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 的 `default:` 值等于 `services/agent/package.json` 的 `version`。

**验证命令**:
```bash
AGENT_VER=$(node -e "console.log(require('./services/agent/package.json').version)") && \
GHA_VER=$(grep -m1 'default:' .github/workflows/agent-e2e-video.yml | sed 's/.*default: *"\(.*\)".*/\1/' | tr -d ' ') && \
echo "agent_ver=$AGENT_VER gha_ver=$GHA_VER" && \
[ "$AGENT_VER" = "$GHA_VER" ] || { echo "FAIL: GHA default=$GHA_VER != agent=$AGENT_VER"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，GHA default 等于 agent package.json version（当前 1.1.31）

---

## E2E 验收（final-e2e — windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud

> GHA `agent-e2e-video.yml` workflow_dispatch，在 windows-latest Runner 上下载 agent install pack 并运行 Playwright E2E。

### final-e2e: Playwright on windows-latest

此 sprint 的 final-e2e 直接触发现有 `agent-e2e-video.yml`，它会：
1. 下载 `zenithjoy-agent-v${agent_version}.tar.gz`
2. 安装依赖 + 下载测试视频
3. 启动 Agent（接 `https://autopilot.zenjoymedia.media`）
4. 运行 `npx playwright test e2e/agent-video-pipeline.spec.js`

**PASS 标准**：Playwright 测试通过，`detected_aspect` 断言非空（非 null），GHA job exit 0
**FAIL 标准**：任何 step exit≠0 OR Playwright 失败 OR agent 15min 内超时

---

## Workstreams

workstream_count: 3

### Workstream 1: PATCH /progress 响应合规 → `{"ok": true}`

**范围**: 仅改 `updateProgress` 最后一行：`res.json(updated)` → `res.json({ ok: true })`
**大小**: S（<20行净增，1文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/patch-ok.test.ts`

---

### Workstream 2: E2E spec — W-G + 9:16 + 非空 detected_aspect 强断言

**范围**: 在 `e2e/agent-video-pipeline.spec.js` step 3 加 W-G 模板选择 + 9:16 按钮点击；step 5 加严格 detected_aspect 非 null 断言
**大小**: M（~60行净增，1文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/e2e-spec.test.ts`

---

### Workstream 3: GHA workflow default version → 1.1.31

**范围**: 仅改 `.github/workflows/agent-e2e-video.yml` 的 `default:` 字段值
**大小**: S（~3行净增，1文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/gha-version.test.ts`

---

## Workstreams 切分确认

- 整体净增 ~83 行（WS1≈15 + WS2≈60 + WS3≈8），< 200 行阈值
- 每 WS ≤ 1 文件，远低于 3 文件上限
- 允许 ws_count=1（但使用 3 WS 为清晰分层）
- 串行链：ws1→[]，ws2→[ws1]，ws3→[ws2]

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/patch-ok.test.ts` | updateProgress 返回 `{ok:true}`；keys==["ok"]；禁用字段检查；supertest PATCH 响应 | ≥1 failure（当前返回 res.json(updated)） |
| WS2 | `tests/ws2/e2e-spec.test.ts` | spec 含 W-G；spec 含 9:16；spec 强断言 detected_aspect；spec 不接受 null | ≥1 failure（缺 W-G/9:16/严格断言） |
| WS3 | `tests/ws3/gha-version.test.ts` | GHA default 等于 agent version | ≥1 failure（当前 1.1.30 ≠ 1.1.31） |
