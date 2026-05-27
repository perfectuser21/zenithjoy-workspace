# Sprint Contract Draft (Round 1)

**Sprint**: AI 视频 Pipeline：模板真实渲染 + original_script + 画幅检测
**Journey**: Line 01 智能发布
**journey_type**: user_facing
**target_environment**: windows_cloud
**propose_round**: 1
**propose_branch**: cp-harness-propose-r1-96db2647

---

## Golden Path

[用户填表] → [API 创建 job 含新字段] → [Agent ffprobe 检测画幅] → [compose-template 模板专属渲染] → [Agent 单文件输出] → [Dashboard 显示 completed + detected_aspect]

---

### Step 1: 用户在 LocalVideoPipelinePage 填写表单并提交

**来源**: `[FROM_PRD]` — PRD "Golden Path" 第1步："用户从 Dashboard 本地视频页 → 填写原始文案（可选）+ 选模板 + 选画幅 → 提交 job"

**可观测行为**: LocalVideoPipelinePage 显示 `original_script` 文本域 + 画幅选择器（9:16 / 16:9 / 自动检测），用户填写后 POST 到 `/api/ai-video/jobs` 携带这两个新字段

**验证命令**:
```bash
# 验证 Dashboard 页面源码包含 original_script 状态和画幅选择器
node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');
if(!c.includes('original_script'))process.exit(1);
if(!c.includes('target_aspect'))process.exit(1);
console.log('OK')"
```

**硬阈值**: `original_script` + `target_aspect` 同时存在于 LocalVideoPipelinePage.tsx 源码

---

### Step 2: API 接收并持久化新字段，response 含完整 schema

**来源**: `[FROM_PRD]` — PRD "Response Schema POST /api/ai-video-pipeline/" 节，字段 `original_script (string|null)` + `target_aspect (string|null)` + `detected_aspect: null`

**可观测行为**: POST `/api/ai-video/jobs` body 含 `original_script` + `target_aspect` → INSERT 写入 `zenithjoy.ai_video_pipeline_jobs` → RETURNING * → response 包含 `original_script`、`target_aspect`、`detected_aspect: null`

**验证命令**:
```bash
# 验证 migration SQL 含三个新列
node -e "
const c=require('fs').readFileSync(
  require('fs').readdirSync('apps/api/db/migrations')
    .filter(f=>f.includes('video_pipeline_new_fields')||f.includes('original_script'))
    .sort().pop()
    ? 'apps/api/db/migrations/'+require('fs').readdirSync('apps/api/db/migrations')
        .filter(f=>f.includes('video_pipeline_new_fields')||f.includes('original_script'))
        .sort().pop()
    : 'NOTFOUND',
  'utf8');
['original_script','target_aspect','detected_aspect'].forEach(f=>{if(!c.includes(f))process.exit(1)});
console.log('OK')
"
```

**硬阈值**: migration 含三列定义；`aspect_ratio`/`script`/`raw_script` 不出现为 response key

---

### Step 3: Agent ffprobe Step 1 补读 width/height，计算 detectedAspect，PATCH 写回 DB

**来源**: `[FROM_PRD]` — PRD "系统处理 — ffprobe 检测"：读取 `width/height`，rotation=90°/270° 时 swap，计算 detectedAspect，PATCH 写回 DB 的 `detected_aspect` 字段

**可观测行为**: Agent Step 1 读取 `video_stream.width` + `video_stream.height`；rotation=90°/270° 时 effectiveWidth=height, effectiveHeight=width；effectiveWidth < effectiveHeight → `"9:16"`；PATCH `/api/ai-video/jobs/:id/progress` 带 `detected_aspect` 字段

**验证命令**:
```bash
# 验证 Agent handler 含 width/height 读取 + detectedAspect 计算
node -e "
const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
if(!c.includes('width'))process.exit(1);
if(!c.includes('height'))process.exit(1);
if(!c.includes('detectedAspect')||!c.includes('detected_aspect'))process.exit(1);
if(!c.includes('effectiveWidth')||!c.includes('effectiveHeight'))process.exit(1);
console.log('OK')
"
```

**硬阈值**: Agent 源码含 `width`/`height` 读取 + `detectedAspect` 计算 + `detected_aspect` PATCH

---

### Step 4: compose-template 按 templateId 分发到专属函数，生成视觉正确 HTML

**来源**: `[FROM_PRD]` — PRD "系统处理 — 模板 HTML 生成"："`compose-template` API 按 templateId 分发到 `_buildWGHtml` / `_buildCHtml` / `_buildRHtml` 三个专属函数，生成与 JSX 视觉一致的 HTML"

**可观测行为**: `composeTemplate` handler 根据 `job.template_id` 分发：`"W-G"→_buildWGHtml`、`"C"→_buildCHtml`、`"R"→_buildRHtml`，每个函数输出与对应 JSX 模板（颜色/布局/字体）视觉一致的 HTML；response = `{ html, aspect }`

**验证命令**:
```bash
# 验证三个专属函数存在
node -e "
const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');
['_buildWGHtml','_buildCHtml','_buildRHtml'].forEach(fn=>{
  if(!c.includes(fn)){console.error('FAIL: missing '+fn);process.exit(1)}
});
console.log('OK')
"
# 验证 dispatch 逻辑存在（switch 或 if/else 映射 W-G/C/R）
node -e "
const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');
if(!c.includes('W-G')&&!c.includes(\"'W-G'\"))process.exit(1);
if(!c.includes('_buildWGHtml'))process.exit(1);
console.log('OK')
"
```

**硬阈值**: 三个函数均存在；dispatch 逻辑正确映射；`content`/`result`/`ratio` 不作为 response key

---

### Step 5: Agent 计算 effectiveTarget，非模板路径只生成单个文件

**来源**: `[FROM_PRD]` — PRD "系统处理 — 视频输出"："`effectiveTarget = target_aspect ?? detectedAspect ?? '9:16'`，只生成对应一个文件"

**可观测行为**: Agent 取 `job.target_aspect ?? detectedAspect ?? "9:16"` 作为 effectiveTarget；非模板路径按此值生成单个 `9_16.mp4` 或 `16_9.mp4`，不再双文件输出

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
if(!c.includes('effectiveTarget'))process.exit(1);
if(!c.includes('target_aspect'))process.exit(1);
console.log('OK')
"
```

**硬阈值**: Agent 含 `effectiveTarget` 逻辑；双文件输出路径被单文件路径替代

---

### Step 6: GET job 返回含 detected_aspect 值，顶层含三个新字段

**来源**: `[AI_ADDED]` — 防止 generator 遗漏 SELECT 新字段：GAN Round 1 Proposer 加入，理由：service.ts 使用 `SELECT *` 但 TypeScript 接口需声明新字段才能 TypeScript 编译通过 + 前端需从 getJob 响应读 `detected_aspect` 展示，不加此步 generator 可能漏更新 `PipelineJob` 接口

**可观测行为**: `GET /api/ai-video/jobs/:id` response 顶层含 `original_script`、`target_aspect`、`detected_aspect` 三字段（ffprobe 完成后 `detected_aspect` 为 `"9:16"` 或 `"16:9"`，否则 `null`）

**验证命令**:
```bash
# 验证 PipelineJob interface 含三个新字段
node -e "
const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');
['original_script','target_aspect','detected_aspect'].forEach(f=>{
  if(!c.includes(f)){console.error('FAIL: interface missing '+f);process.exit(1)}
});
console.log('OK')
"
```

**硬阈值**: `PipelineJob` interface 含三字段；禁用字段 `aspectRatio`/`aspect_ratio`/`script`/`raw_script`/`source_script` 不出现

---

### Step 7: Agent 版本更新至 v1.1.30，GHA workflows 更新触发版本

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 写 "version bump → v1.1.29" 但当前版本已是 v1.1.29（git history 可证）；新功能（original_script/ffprobe width/height）需要新版本标识，proposer 将目标版本修正为 v1.1.30；GHA workflow 默认 agent_version 需同步更新以使 Final E2E 测试正确的包版本

**可观测行为**: `services/agent/package.json` version = `"1.1.30"`；`agent-e2e-video.yml` default `agent_version` = `"1.1.30"`

**验证命令**:
```bash
node -e "
const p=JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8'));
if(p.version!=='1.1.30'){console.error('FAIL: version='+p.version);process.exit(1)}
console.log('OK')
"
```

**硬阈值**: package.json version = `"1.1.30"`

---

## E2E 验收（Final E2E — windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E 形式**: `agent-e2e-video.yml` 安装包 + Playwright spec（GHA windows-latest）

### E2E 脚本更新要求（写入 `e2e/agent-video-pipeline.spec.js`）

E2E spec 需在现有基础上补充：
1. `page.fill('textarea[placeholder*="文案"]', 'E2E original_script 测试')` — 填写 original_script
2. 提交后通过 jobId 验证 API response 含 `original_script` 字段
3. job 完成后验证 `detected_aspect` 非 null

```javascript
// E2E 新增验证段（拼接在现有 step 3 之后）
// 验证 create job 响应含 original_script
if (jobId) {
  const apiResp = await page.request.get(`${BASE}/api/ai-video/jobs/${jobId}`);
  const jobData = await apiResp.json();
  if (!jobData.hasOwnProperty('original_script')) {
    throw new Error('FAIL: job response missing original_script field');
  }
  if (!jobData.hasOwnProperty('detected_aspect')) {
    throw new Error('FAIL: job response missing detected_aspect field');
  }
  console.log('[e2e] ✅ original_script present:', jobData.original_script !== undefined);
  console.log('[e2e] ✅ detected_aspect:', jobData.detected_aspect);
}
```

**PASS 标准**: Playwright E2E 绿灯；`original_script` + `detected_aspect` 字段存在于 job API 响应
**FAIL 标准**: 任何 step 抛异常 OR `original_script` 缺失 OR `detected_aspect` 缺失
**GHA workflow**: `.github/workflows/agent-e2e-video.yml`（`workflow_dispatch` + `windows-latest`）

---

## Workstreams

**workstream_count**: 5

---

### Workstream 1: DB Migration + API 层（service interface + controller 读写新字段）

**范围**: 新增 migration SQL（3列：original_script/target_aspect/detected_aspect），更新 PipelineJob interface，createJob 接受新字段，updateProgress 接受 detected_aspect
**大小**: M（~140 行净增，3 文件）
**依赖**: 无（串行链起点）
**BEHAVIOR 覆盖测试文件**: `tests/ws1/video-pipeline-new-fields.test.ts`

---

### Workstream 2: 三个模板专属 HTML Builder 函数（WG/C/R）+ composeTemplate dispatch

**范围**: `ai-video-pipeline-ai.controller.ts` 新增 `_buildWGHtml`（9:16 Bauhaus 风）、`_buildCHtml`（16:9 纪录片风）、`_buildRHtml`（16:9 深酒红风）三函数；composeTemplate 按 templateId dispatch；response 字段合规
**大小**: L（~230 行净增，1 文件）
**依赖**: Workstream 1 完成后
**BEHAVIOR 覆盖测试文件**: `tests/ws2/template-builders.test.ts`

---

### Workstream 3: Agent ffprobe 补 width/height + detectedAspect PATCH + 单文件输出

**范围**: `video-pipeline.ts` Step 1 补读 `width/height`；计算 `detectedAspect`；PATCH `detected_aspect`；计算 `effectiveTarget`；非模板路径只生成单个输出文件
**大小**: M（~110 行净增/改，1 文件）
**依赖**: Workstream 2 完成后
**BEHAVIOR 覆盖测试文件**: `tests/ws3/agent-ffprobe-aspect.test.ts`

---

### Workstream 4: Dashboard UI + E2E spec 更新

**范围**: `LocalVideoPipelinePage.tsx` 加 original_script textarea + 画幅选择器 + createJob 传新字段；`e2e/agent-video-pipeline.spec.js` 补新字段填写 + API schema 断言
**大小**: M（~130 行净增/改，2 文件）
**依赖**: Workstream 3 完成后
**BEHAVIOR 覆盖测试文件**: `tests/ws4/dashboard-ui-aspect.test.ts`

---

### Workstream 5: Agent 版本 v1.1.30 + GHA workflow 更新

**范围**: `services/agent/package.json` version = `"1.1.30"`；`agent-e2e-video.yml` 默认版本 = `"1.1.30"`；`agent-installpack.yml` 版本引用更新
**大小**: S（~15 行净增/改，3 文件）
**依赖**: Workstream 4 完成后
**BEHAVIOR 覆盖测试文件**: `tests/ws5/agent-version.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/video-pipeline-new-fields.test.ts` | migration 三列/interface 字段/controller 读写/禁用字段反向 | import 报 type error：PipelineJob 无新字段 |
| WS2 | `tests/ws2/template-builders.test.ts` | _buildWGHtml/_buildCHtml/_buildRHtml 存在/dispatch 正确/response schema/禁用字段 | import 找不到 _buildWGHtml 等函数 |
| WS3 | `tests/ws3/agent-ffprobe-aspect.test.ts` | width/height 读取/detectedAspect 计算/PATCH 字段/effectiveTarget/单文件输出 | 测试文件 grep 源码中缺失的逻辑 |
| WS4 | `tests/ws4/dashboard-ui-aspect.test.ts` | original_script 状态/target_aspect 传参/aspect 选择器/E2E spec 更新 | Dashboard 无新字段 → 断言失败 |
| WS5 | `tests/ws5/agent-version.test.ts` | package.json 版本/GHA 版本/无硬编码旧版本 | package.json 版本 = 1.1.29 ≠ 1.1.30 → 失败 |

---

## Workstreams 切分说明

本合同共 5 个 workstream（PRD 提示 WS1~WS4，但 PRD 版本 bump 需修正为 v1.1.30 + GHA 更新独立为 WS5，以保持每 WS ≤ 200 行 + ≤ 3 文件限制）：
- WS1: 3 文件，~140 行 ✓
- WS2: 1 文件，~230 行（超 200 行，但仅 1 文件，Builder 三函数不可再拆分，已是最小合理切分）
- WS3: 1 文件，~110 行 ✓
- WS4: 2 文件，~130 行 ✓
- WS5: 3 文件，~15 行 ✓

> 注：WS2 超 200 行但文件数 =1，三个 builder 函数高度相关（都在同一 controller，dispatch 逻辑依赖所有三个），强制再拆会造成 partial implementation 无法单独验收。
