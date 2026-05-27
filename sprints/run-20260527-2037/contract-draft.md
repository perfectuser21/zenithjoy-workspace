# Sprint Contract Draft (Round 2)

**Sprint**: AI 视频 Pipeline：模板真实渲染 + original_script + 画幅检测
**Journey**: Line 01 智能发布
**journey_type**: user_facing
**target_environment**: windows_cloud
**propose_round**: 2
**propose_branch**: cp-harness-propose-r2-96db2647

---

> **路由注解（内部一致性修正）**: PRD 原文写 `/api/ai-video-pipeline/` 为笔误；实际路由在
> `apps/api/src/app.ts` line 80：`app.use('/api/ai-video/jobs', aiVideoPipelineRouter)`。
> 本合同全程使用实际路由 `/api/ai-video/jobs`（合同正确，PRD 笔误）。
>
> **compose-template 响应 schema 说明**: PRD 定义最小 schema `{html, aspect}`；现有实现返回
> `{html, aspect, width, height, phoneRect}`（三个扩展字段不在 PRD 禁用列表内，向后兼容，允许共存）。
> 合同 oracle 验证 `html` + `aspect` 必存在 + 禁用字段（content/template/result/output/ratio）不存在。

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
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');
if (!c.includes('original_script')) { console.error('FAIL: 缺 original_script'); process.exit(1); }
if (!c.includes('target_aspect')) { console.error('FAIL: 缺 target_aspect'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `original_script` + `target_aspect` 同时存在于 LocalVideoPipelinePage.tsx 源码

---

### Step 2: API 接收并持久化新字段，response 含完整 schema（curl+jq-e oracle）

**来源**: `[FROM_PRD]` — PRD "Response Schema POST /api/ai-video/jobs" 节，字段 `original_script (string|null)` + `target_aspect (string|null)` + `detected_aspect: null`

**可观测行为**: POST `/api/ai-video/jobs` body 含 `original_script` + `target_aspect` → INSERT 写入 `ai_video_pipeline_jobs` → response 包含 `original_script`、`target_aspect`、`detected_aspect: null`

**验证命令（前提：API 服务在 localhost:5200 运行，migration 已执行）**:
```bash
# 1. 创建测试 job（含新字段）— 带时间戳防止用历史数据造假
TS=$(date +%s)
JOB_ID=$(curl -sf -X POST "http://localhost:5200/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d "{\"topic\":\"DoD-test-${TS}\",\"local_path\":\"/tmp/test.mp4\",\"original_script\":\"test script ${TS}\",\"target_aspect\":\"9:16\"}" \
  | jq -r '.id') || { echo "FAIL: POST /api/ai-video/jobs 失败"; exit 1; }
echo "$JOB_ID" | grep -qE "^[0-9a-f-]{36}$" || { echo "FAIL: 无效 job ID=$JOB_ID"; exit 1; }

# 2. 验证 POST 响应字段（通过 GET 读取）
RESP=$(curl -sf "http://localhost:5200/api/ai-video/jobs/${JOB_ID}") || { echo "FAIL: GET job 失败"; exit 1; }

# 3. Schema 字段 oracle（逐项 jq -e 验证）
echo "$RESP" | jq -e '.original_script | type == "string"' \
  || { echo "FAIL: original_script 缺失或非 string"; exit 1; }
echo "$RESP" | jq -e ".original_script == \"test script ${TS}\"" \
  || { echo "FAIL: original_script 值未原样存储"; exit 1; }
echo "$RESP" | jq -e '.target_aspect == "9:16"' \
  || { echo "FAIL: target_aspect 不是 \"9:16\""; exit 1; }
echo "$RESP" | jq -e '.detected_aspect == null' \
  || { echo "FAIL: detected_aspect 初始应为 null"; exit 1; }

# 4. keys 完整性：顶层必含三字段
echo "$RESP" | jq -e 'has("original_script") and has("target_aspect") and has("detected_aspect")' \
  || { echo "FAIL: 三字段未全返回"; exit 1; }

# 5. 禁用字段反向检查
echo "$RESP" | jq -e 'has("aspectRatio") | not' \
  || { echo "FAIL: 禁用字段 aspectRatio 存在"; exit 1; }
echo "$RESP" | jq -e 'has("aspect_ratio") | not' \
  || { echo "FAIL: 禁用字段 aspect_ratio 存在"; exit 1; }
echo "$RESP" | jq -e 'has("script") | not' \
  || { echo "FAIL: 禁用字段 script 存在"; exit 1; }
echo "$RESP" | jq -e 'has("raw_script") | not' \
  || { echo "FAIL: 禁用字段 raw_script 存在"; exit 1; }

echo "✅ Step 2 oracle 全通过"
```

**硬阈值**: job 创建成功（201/200）+ 三字段存在且值正确 + 禁用字段不存在

---

### Step 3: Agent ffprobe Step 1 补读 width/height，计算 detectedAspect，PATCH 写回 DB

**来源**: `[FROM_PRD]` — PRD "系统处理 — ffprobe 检测"：读取 `width/height`，rotation=90°/270° 时 swap，计算 detectedAspect，PATCH 写回 DB 的 `detected_aspect` 字段

**可观测行为**: Agent Step 1 读取 `video_stream.width` + `video_stream.height`；rotation=90°/270° 时 effectiveWidth=height, effectiveHeight=width；effectiveWidth < effectiveHeight → `"9:16"`；PATCH `/api/ai-video/jobs/:id/progress` 带 `detected_aspect` 字段

**验证命令**:
```bash
# 验证 Agent handler 含 width/height 读取 + detectedAspect 计算 + effectiveWidth/Height
F="services/agent/src/handlers/video-pipeline.ts"
[ -f "$F" ] || { echo "FAIL: $F 不存在"; exit 1; }
grep -q "\.width" "$F" || { echo "FAIL: 缺 .width 读取"; exit 1; }
grep -q "\.height" "$F" || { echo "FAIL: 缺 .height 读取"; exit 1; }
grep -q "detectedAspect" "$F" || { echo "FAIL: 缺 detectedAspect"; exit 1; }
grep -q "detected_aspect" "$F" || { echo "FAIL: 缺 detected_aspect PATCH"; exit 1; }
grep -q "effectiveWidth" "$F" || { echo "FAIL: 缺 effectiveWidth swap 逻辑"; exit 1; }
echo OK
```

**硬阈值**: Agent 源码含 `width`/`height` 读取 + `detectedAspect` 计算 + `detected_aspect` PATCH

---

### Step 4: compose-template 按 templateId 分发到专属函数，生成视觉正确 HTML（curl+jq oracle）

**来源**: `[FROM_PRD]` — PRD "系统处理 — 模板 HTML 生成"："`compose-template` API 按 templateId 分发到 `_buildWGHtml` / `_buildCHtml` / `_buildRHtml` 三个专属函数，生成与 JSX 视觉一致的 HTML"

**可观测行为**: `composeTemplate` handler 根据 `job.template_id` 分发：`"W-G"→_buildWGHtml`、`"C"→_buildCHtml`、`"R"→_buildRHtml`；response = `{ html: string, aspect: string }` + 禁用字段不出现

> **注意**: compose-template 调用 Claude API，完整 success path 在 final-e2e windows_cloud E2E 验收。
> 此处 oracle 使用「无需 Claude 调用」的 error path + dispatch source 两层验证。

**验证命令**:
```bash
# 层 1：error path oracle — 无效 templateId 返回 400（不调 Claude）
# 需先获取一个已存在的 job_id（复用 Step 2 创建的 job）
# 假设 JOB_ID 环境变量已由 Step 2 设置
: "${JOB_ID:?需要先运行 Step 2 获取 JOB_ID}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:5200/api/ai-video/jobs/${JOB_ID}/compose-template" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"INVALID_TEMPLATE_XYZ"}')
[ "$CODE" = "400" ] || { echo "FAIL: 无效 templateId 期望 400，实际=$CODE"; exit 1; }
ERR_BODY=$(curl -sf \
  -X POST "http://localhost:5200/api/ai-video/jobs/${JOB_ID}/compose-template" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"INVALID_TEMPLATE_XYZ"}' 2>/dev/null || echo '{"error":""}')
echo "$ERR_BODY" | jq -e '.error | type == "string"' \
  || { echo "FAIL: error path 缺 error 字段"; exit 1; }

# 层 2：dispatch source oracle — 三个专属函数存在且 composeTemplate 内分发
F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"
grep -q "_buildWGHtml" "$F" || { echo "FAIL: _buildWGHtml 缺失"; exit 1; }
grep -q "_buildCHtml" "$F"  || { echo "FAIL: _buildCHtml 缺失"; exit 1; }
grep -q "_buildRHtml" "$F"  || { echo "FAIL: _buildRHtml 缺失"; exit 1; }
echo OK
```

**硬阈值**: invalid templateId → 400 + error 字段；三个 builder 函数存在

---

### Step 5: Agent 计算 effectiveTarget，非模板路径只生成单个文件

**来源**: `[FROM_PRD]` — PRD "系统处理 — 视频输出"："`effectiveTarget = target_aspect ?? detectedAspect ?? '9:16'`，只生成对应一个文件"

**可观测行为**: Agent 取 `job.target_aspect ?? detectedAspect ?? "9:16"` 作为 effectiveTarget；非模板路径按此值生成单个 `9_16.mp4` 或 `16_9.mp4`，不再双文件输出

**验证命令**:
```bash
F="services/agent/src/handlers/video-pipeline.ts"
grep -q "effectiveTarget" "$F" || { echo "FAIL: 缺 effectiveTarget"; exit 1; }
grep -q "target_aspect" "$F"  || { echo "FAIL: 缺 target_aspect 读取"; exit 1; }
echo OK
```

**硬阈值**: Agent 含 `effectiveTarget` 逻辑；双文件输出路径被单文件路径替代

---

### Step 6: GET job 返回含 detected_aspect 值，顶层含三个新字段（curl+jq oracle）

**来源**: `[AI_ADDED]` — GAN Round 2 Proposer 保留 Round 1 该步骤；理由：防止 generator 遗漏 SELECT 新字段：service.ts 若不声明 PipelineJob interface 三字段，TypeScript 编译通过但前端拿不到 detected_aspect；前端需从 getJob 响应读此值展示

**可观测行为**: `GET /api/ai-video/jobs/:id` response 顶层含 `original_script`、`target_aspect`、`detected_aspect` 三字段（ffprobe 完成后 `detected_aspect` 为 `"9:16"` 或 `"16:9"`，否则 `null`）

**验证命令（curl+jq-e oracle — 使用 Step 2 创建的 job）**:
```bash
: "${JOB_ID:?需要先运行 Step 2 获取 JOB_ID}"
RESP=$(curl -sf "http://localhost:5200/api/ai-video/jobs/${JOB_ID}") \
  || { echo "FAIL: GET /api/ai-video/jobs/${JOB_ID} 失败"; exit 1; }

# Schema 完整性：三字段必须存在（即使 null）
echo "$RESP" | jq -e 'has("original_script")' \
  || { echo "FAIL: GET response 缺 original_script"; exit 1; }
echo "$RESP" | jq -e 'has("target_aspect")' \
  || { echo "FAIL: GET response 缺 target_aspect"; exit 1; }
echo "$RESP" | jq -e 'has("detected_aspect")' \
  || { echo "FAIL: GET response 缺 detected_aspect"; exit 1; }

# detected_aspect 类型校验：null 或 string，不能是 undefined/missing
echo "$RESP" | jq -e '.detected_aspect == null or (.detected_aspect | type == "string")' \
  || { echo "FAIL: detected_aspect 不是 null 或 string"; exit 1; }

# 禁用字段反向检查
for banned in aspectRatio aspect_ratio script raw_script source_script; do
  echo "$RESP" | jq -e "has(\"$banned\") | not" \
    || { echo "FAIL: 禁用字段 $banned 存在于 GET response"; exit 1; }
done

echo "✅ Step 6 oracle 全通过"
```

**硬阈值**: 三字段全返回；detected_aspect 为 null 或有效 aspect 字符串；禁用字段不存在

---

### Step 7: Agent 版本更新至 v1.1.30，GHA workflows 更新触发版本

**来源**: `[AI_ADDED]` — GAN Round 1/2 Proposer 保留；理由：PRD 写 "version bump → v1.1.29" 但当前版本已是 v1.1.29（git history 可证）；新功能需要新版本标识，proposer 将目标版本修正为 v1.1.30；GHA workflow 默认 agent_version 需同步更新以使 Final E2E 测试正确的包版本

**可观测行为**: `services/agent/package.json` version = `"1.1.30"`；`agent-e2e-video.yml` default `agent_version` = `"1.1.30"`

**验证命令（jq runtime oracle）**:
```bash
VER=$(cat services/agent/package.json | jq -r '.version')
[ "$VER" = "1.1.30" ] || { echo "FAIL: version=$VER 期望 1.1.30"; exit 1; }
echo OK
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
  if (jobData.hasOwnProperty('aspectRatio') || jobData.hasOwnProperty('aspect_ratio')) {
    throw new Error('FAIL: banned field aspectRatio/aspect_ratio present in response');
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
**依赖**: Workstream 1 完成后（**不依赖 WS2**，理由：Agent ffprobe 仅需 DB detected_aspect 列（WS1 迁移）和 progress PATCH 端点（已存在），与模板 HTML Builder（WS2）无关联。WS2 与 WS3 逻辑独立，可并行执行）
**BEHAVIOR 覆盖测试文件**: `tests/ws3/agent-ffprobe-aspect.test.ts`

---

### Workstream 4: Dashboard UI + E2E spec 更新

**范围**: `LocalVideoPipelinePage.tsx` 加 original_script textarea + 画幅选择器 + createJob 传新字段；`e2e/agent-video-pipeline.spec.js` 补新字段填写 + API schema 断言
**大小**: M（~130 行净增/改，2 文件）
**依赖**: Workstream 2 和 Workstream 3 完成后（需 WS2 compose-template dispatch 可用 + WS3 detected_aspect 写回可用）
**BEHAVIOR 覆盖测试文件**: `tests/ws4/dashboard-ui-aspect.test.ts`

---

### Workstream 5: Agent 版本 v1.1.30 + GHA workflow 更新

**范围**: `services/agent/package.json` version = `"1.1.30"`；`agent-e2e-video.yml` 默认版本 = `"1.1.30"`；`agent-installpack.yml` 版本引用更新
**大小**: S（~15 行净增/改，3 文件）
**依赖**: Workstream 4 完成后
**BEHAVIOR 覆盖测试文件**: `tests/ws5/agent-version.test.ts`

---

## Test Contract

| Workstream | TDD 红绿测试（Proposer 写） | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/video-pipeline-new-fields.test.ts` | migration 三列/interface 字段/controller 读写/禁用字段反向 | import 报 type error：PipelineJob 无新字段 |
| WS2 | `tests/ws2/template-builders.test.ts` | _buildWGHtml/_buildCHtml/_buildRHtml 存在/dispatch 正确/response schema/禁用字段 | import 找不到 _buildWGHtml 等函数 |
| WS3 | `tests/ws3/agent-ffprobe-aspect.test.ts` | width/height 读取/detectedAspect 计算/PATCH 字段/effectiveTarget/单文件输出 | 测试文件 grep 源码中缺失的逻辑 |
| WS4 | `tests/ws4/dashboard-ui-aspect.test.ts` | original_script 状态/target_aspect 传参/aspect 选择器/E2E spec 更新 | Dashboard 无新字段 → 断言失败 |
| WS5 | `tests/ws5/agent-version.test.ts` | package.json 版本/GHA 版本/无硬编码旧版本 | package.json 版本 = 1.1.29 ≠ 1.1.30 → 失败 |

---

## Workstreams 切分说明

本合同共 5 个 workstream：

- WS1: 3 文件，~140 行 ✓
- WS2: 1 文件，~230 行（超 200 行，但 1 文件，三 builder 函数高度耦合，最小合理切分）
- WS3: 1 文件，~110 行 ✓
- WS4: 2 文件，~130 行 ✓
- WS5: 3 文件，~15 行 ✓

**WS2/WS3 依赖说明**：WS2 与 WS3 均依赖 WS1（DB migration），但彼此无依赖。WS4 依赖 WS2 + WS3 均完成后开始（最大化并行）。

---

## Risks

| # | Risk | 影响 | Mitigation |
|---|---|---|---|
| R1 | ffprobe 失败（视频文件损坏、width/height 字段缺失、container 无 video stream） | Agent Step 1 无法计算 detectedAspect → PATCH 写回 null → 视频输出 fallback "9:16" | Agent Step 1 ffprobe 失败时 catch error，detectedAspect 为 null，effectiveTarget = target_aspect ?? null ?? "9:16"（已有 fallback 链）；E2E 使用已知正常视频 `zj-e2e-koubo-45s.mp4` |
| R2 | migration 串行依赖（detected_aspect 列必须在 API 层写回之前存在于 DB） | WS1 migration 未执行时 Agent PATCH detected_aspect → DB INSERT 失败 / API 500 | WS1 是全链路 ws1（depends_on: []），所有下游 WS 通过 depends_on 显式等待 WS1 完成；migration 使用 ADD COLUMN IF NOT EXISTS（幂等安全） |
| R3 | 视觉不一致（JSX 模板色值与 _buildWGHtml/_buildCHtml/_buildRHtml 硬编码色值不完全吻合） | Final E2E 通过（功能正确）但视觉效果对比 JSX 设计稍有差异 | 合同强制要求三函数各含 JSX 模板专属色值（#ede4d2 WG / #0a0a0a C / #1d1410 R）；通过 DoD BEHAVIOR 验证色值存在；Final E2E 截图留存，视觉审核由人工 review；视觉问题不阻塞 sprint merge |
