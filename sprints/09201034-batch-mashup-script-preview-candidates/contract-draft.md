# Sprint Contract Draft (Round 2) — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

> journey_type: user_facing ｜ target_environment: windows_cloud（GitHub Actions windows-latest，权威源 task.payload）
> BASE_REPO: zenithjoy-workspace ｜ 加厚方向：line05/批量混剪 thin → medium（GP f6f96e17）
> contract-gate: skipped (file not found, third-party repo — packages/brain/src/lib/contract-gate.js 不存在)
> Kernel validation identity late-bound：本合同不写死任何 attempt/account/snapshot UUID，E2E 身份从
> Runner 注入的 HARNESS_* / CAPABILITY_SNAPSHOT_ID 读取。

---

## Response Schema（推导来源: PRD字面 + api_registry（apps/api 既有 mashup.ts/materials.ts 端点）推导）

> 信封约定来自 apps/api 既有 mashup.ts/materials.ts：成功 `{success:true, data:<T>, error:null, timestamp}`；
> 失败 `{success:false, data:null, error:{code,message}, timestamp}`。/api/mashup 用 camelCase 字段，
> /api/materials 用 snake_case 字段（沿用既有约定，禁止跨端点混用）。

### Endpoint 1: POST /api/mashup/templates/from-script （新增，Step1）
**Auth**: `X-Upload-Token: <license_key>`（与既有 mashup/materials 路由同口径，租户从凭据反查）
**Body**: `{ "script": <string，必填非空> }`
**Success (HTTP 200)**:
```json
{"success": true, "data": {
  "templateId": "<uuid>",
  "degraded": false,
  "segments": [
    {"slotKey": "seg1", "roleLabel": "开场钩子", "aiTag": "开场", "suggestedCount": 2, "fallbackMapped": false}
  ]
}, "error": null, "timestamp": "<iso>"}
```
- `templateId` (string, 必填): 新落库的 zenithjoy.mashup_templates 行 id — 来源 PRD Step1「生成新 mashup_templates 行」
- `degraded` (boolean, 必填): AI 服务不可用时静默降级固定模板则为 true — 来源 PRD 边界情况
- `segments[].slotKey` (string): 槽位键
- `segments[].roleLabel` (string): AI 解析出的角色/分段名
- `segments[].aiTag` (string): 映射到的现有 ai_tags 枚举值 — 来源 PRD Step1「角色标签映射现有 S1 ai_tags 枚举」
- `segments[].suggestedCount` (number): 该段建议素材数量
- `segments[].fallbackMapped` (boolean): 未命中 ai_tags 枚举时标「兜底映射」true — 来源 PRD Step1
**禁用字段名**（api_registry 同义替换词，正向断言里禁止出现）: `template_id`、`id`（顶层）、`tags`（应为 aiTag）、`count`（应为 suggestedCount）、`fallback`（应为 fallbackMapped）
**Error (HTTP 4xx)**: `{"success": false, "data": null, "error": {"code": "INVALID_BODY", "message": "<string>"}, "timestamp": "<iso>"}`（空 script → 400）

### Endpoint 2: GET /api/materials/:id/preview-url （新增，Step2）
**Auth**: `X-Upload-Token`
**Success (HTTP 200)**: `{"success": true, "data": {"preview_url": "<signed url string>"}, "error": null, "timestamp": "<iso>"}`
- `preview_url` (string, 必填): 按 storage_key 重签的 signedUrl（snake_case，沿用 materials.ts GET / 的 `preview_url`）— 来源 PRD Step2「复用 signedUrl 模式」/「signedUrl 过期→前端自动重签重试」
**Error**: 素材不存在或非本租户 → HTTP 404 `error.code=MATERIAL_NOT_FOUND`；无凭据 → 401

### Endpoint 3: POST /api/mashup/runs/:id/candidates （改造，Step3；沿用既有路径，扩展返回体）
**Body**: `{ "targetCount": 200 }`
**Success (HTTP 200)**:
```json
{"success": true, "data": {
  "runId": "<uuid>",
  "generatedCount": 137,
  "candidates": [
    {"id": "<uuid>", "score": 2.71, "slotFill": {"hook": "<materialId>"}, "thumbnailUrl": "<collage url>"}
  ]
}, "error": null, "timestamp": "<iso>"}
```
- `generatedCount` (number, 必填): 去重后实际生成候选数（如实显示，≤200，决策 3ed368c3）— 新增，来源 PRD Step3
- `candidates[].thumbnailUrl` (string, 必填): 缩略图拼贴 URL（抽帧自 video-frame-extract.ts）— 新增，来源 PRD Step3
- `candidates[].id/score/slotFill`: 沿用既有 mashup.ts 返回体
**禁用字段名**: `count`（应为 generatedCount）、`total`、`thumbnail`（应为 thumbnailUrl）、`thumb_url`

### Endpoint 4: POST /api/mashup/candidates/:id/render （改造，Step4；并发闸 + 队列 + 失败态）
**Success — 拿到并发位并渲染完成 (HTTP 200)**:
```json
{"success": true, "data": {"status": "completed", "contentId": "<uuid>", "exportUrl": "<url>",
  "safetyCheckStatus": "passed", "watermarkCheckStatus": "passed"}, "error": null, "timestamp": "<iso>"}
```
**Success — 并发位被占，排队 (HTTP 200)**:
```json
{"success": true, "data": {"status": "queued", "queuePosition": 1}, "error": null, "timestamp": "<iso>"}
```
**Success — 渲染失败态 (HTTP 200)**:
```json
{"success": true, "data": {"status": "render_failed", "reason": "<string>"}, "error": null, "timestamp": "<iso>"}
```
- `status` (string, 必填): `completed | queued | render_failed`（新增 queued / render_failed 两态）— 来源 PRD Step4
- `queuePosition` (number): status=queued 时的排队位（「第 N 位」，hk-vps 并发上限=1，决策 d6bedf80）
- `reason` (string): status=render_failed 时的失败原因（客户可「重新渲染」或「换一条候选」，非死路）

---

## Golden Path

**锚定父路声明**: 覆盖父路 line05/batch_mashup（GP f6f96e17）第 1-4 步（对应 product-map 中 batch_mashup step1-4 的加厚；GP-Anchor 单步声明见 ## GP-Anchor）

[粘贴文案] → [动态分段生成模板] → [在线预览挑素材] → [生成候选缩略图拼贴浏览] → [选中一条才真实渲染] → [出口：1080P 成片]

### Step 1: 客户粘贴文案 → 系统解析出动态分段模板
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 验收标准第 1 条

**可观测行为**: 客户 POST 一段文案，得到有序 segments（每段含角色标签→ai_tags 枚举映射、建议素材数、兜底映射标记），且新 mashup_templates 行落库。AI 不可用时 degraded=true 走固定模板，不阻断。

**验证命令**:
```bash
# Step1 服务端接缝真验（真 Postgres，禁 mock mashup_templates 写边；TOAPIS 由 deps 注入替身）
node node_modules/vitest/vitest.mjs run --no-cache \
  sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts
# 期望：6 个用例全绿（含 degraded 降级 / fallbackMapped / INV-3 去重 / INV-5 截断 / 空文案 400）
```
**硬阈值**: segments.length ≥ 1；命中枚举段 aiTag ∈ AI_TAG_VOCAB 单一来源；degraded 路径不抛异常；空文案返回 INVALID_BODY。

---

### Step 2: 客户在 PickStep 在线预览素材 → 挑选各槽位素材
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + 验收标准第 2 条

**可观测行为**: 素材卡片可点击直接在线播放（`<video>` 元素真实发出 signedUrl 请求）；signedUrl 过期时前端调 GET /:id/preview-url 自动重签重试；损坏/不支持素材标「预览不可用」，不阻断选择。

**验证命令**:
```bash
# Step2 重签端点契约（读路径，替身 db + InMemory 存储）
node node_modules/vitest/vitest.mjs run --no-cache \
  sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-materials-preview.test.ts
# 期望：本租户 200 带 preview_url / 非本租户 404 / 无凭据 401
```
**硬阈值**: 200 响应 data.preview_url 为非空字符串；跨租户 404；UI 层 `<video>` 可播放（见 ## E2E 验收 Playwright）。

---

### Step 3: 客户点「生成候选」→ 候选 200+ 缩略图拼贴虚拟滚动浏览
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 验收标准第 3 条

**可观测行为**: targetCount=200 请求，返回去重后实际数 generatedCount（≤200，如实显示，不凑数）；每条候选含 thumbnailUrl 缩略图拼贴（抽帧）；前端虚拟滚动，DOM 节点数与可视区域一致（非 200+ 全量渲染）。

**验证命令**:
```bash
# Step3 候选落库接缝真验（真 Postgres，禁 mock mashup_candidates 写边；仅 mock embedding 模型）
node node_modules/vitest/vitest.mjs run --no-cache \
  sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-candidates-thumbnail.test.ts
# 期望：generatedCount==candidates.length≤200 且>0；每条含 thumbnailUrl；真表 5min 时间窗行数吻合
```
**硬阈值**: generatedCount ≤ 200 且 == candidates.length；每条 thumbnailUrl 非空；DB 5 分钟时间窗内候选行数 == candidates.length；前端 DOM 节点数 == 可视区域节点数（见 ## E2E 验收）。

---

### Step 4: 客户选中一条候选 → 此刻才真实 ffmpeg 渲染（并发上限=1）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 验收标准第 4 条

**可观测行为**: 选中前所有候选均未真实渲染；选中触发真实 ffmpeg；并发上限=1，第二个并发请求返回 status=queued + queuePosition（第 N 位）；渲染失败→status=render_failed，可重试或换候选。

**验证命令**:
```bash
# Step4 并发队列接缝真验（禁 mock 被改的并发边，直接对真实队列模块断言；ffmpeg 受控替身）
node node_modules/vitest/vitest.mjs run --no-cache \
  sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts
# 期望：RENDER_MAX_CONCURRENCY==1；第二并发提交 status=queued queuePosition=1；失败→render_failed
```
**硬阈值**: RENDER_MAX_CONCURRENCY == 1；并发第 2 个 status=queued；ffmpeg 失败映射 render_failed；真实 ffmpeg 出片见 ## E2E 验收（windows_cloud 出 1080P mp4，ffprobe 验音视频流）。

---

### Step 5（出口，已有不动）: 渲染完成 → 结果页 1080P 成片，内容安全自查
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条（明确「已有，不动」）

**可观测行为**: 沿用现有 mashup-render.ts fail-closed 内容安全/水印 Gate + ResultStep 内联预览。本 sprint 不改其逻辑。

**验证命令**: `（本 Step 不在改动范围，沿用现有 mashup-render.test.ts / MashupPage.ResultStep.test.tsx 回归保护，见 ## 已知约束）`
**硬阈值**: 现有回归测试保持全绿（不回退）。

---

## 已知约束（来自回归测试 + 累积FR）

> 关键模块回归测试（本 sprint 改动这些模块，必须保持其现有用例全绿，不回退）：
- [apps/api/src/services/__tests__/mashup-candidate-generation.test.ts] → 候选组合/排序/J10 候选级去重（Jaccard 0.8）/固定槽位透传逻辑（改造返回体时不得破坏）
- [apps/api/src/services/__tests__/mashup-render.test.ts] → fail-closed 内容安全/水印 Gate（加并发队列/失败态时不得破坏）
- [apps/api/src/services/__tests__/mashup-slot-assignment.test.ts] → S2 槽位分配打分/三态降级
- [apps/api/src/services/__tests__/video-frame-extract.test.ts] → 抽帧 extractFrameBase64（缩略图拼贴复用，不改抽帧本体）
- [apps/api/src/routes/__tests__/materials.test.ts] → 素材列表租户隔离 + preview_url 签名（新增 :id/preview-url 时不得破坏隔离）
- [apps/api/src/routes/__tests__/mashup.test.ts] → 既有 templates/runs/candidates/select/render 端点契约
- [apps/dashboard/src/pages/MashupPage.ResultStep.test.tsx] → 结果页内联预览（Step5 不动）
- [累积FR] context-manifest: 本 line golden-paths 注册表返回空数组（PRD 已注明），无历史累积 FR 约束条目（本 line 暂无历史）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①文案→动态分段模板落库 ②素材在线预览重签端点 ③候选200+带缩略图拼贴+如实数量 ④渲染并发=1排队+失败态 |
| **NFR（做得多好）** | 非功能 | 去重 Jaccard=0.8（不改）；候选 targetCount=200 如实返回≤200；ffmpeg 并发上限=1；虚拟滚动 DOM==可视区；防重复提交按钮禁用+去抖 |
| **Invariant（永不违反）** | 不变量 | 见 ## 禁 mock 边清单 + INV-1..5（DoD）：ai_tags 枚举单源、付费调用去重、null契约显式else、字段长度截断、dashboard 三件套 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效 | signedUrl 默认 TTL 3600s（DEFAULT_SIGNED_URL_TTL_SECONDS），过期前端自动重签；候选缓存随 run 生命周期 |
| **死亡告警（停了谁知道）** | 告警 | 文案解析 AI 降级 / 渲染失败须落 Brain log（PRD 可观测约束）；主理人经 staging 预览闸 Bark 知晓 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 模板/候选落库以真表 5min 时间窗行数确认；渲染以 status=completed+exportUrl 可播放确认；预览以 `<video>` 真实发 signedUrl 请求确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 文案解析 AI 是否「不可用」需降级 | A. 捕获 timeout/5xx/鉴权/欠费/网络统一归一类; B. 逐错误码分别处理 | A 统一归「AI服务不可用」静默降级固定模板 | 用户拍板：Step1 是输入结构化非内容安全判定，不阻断（区别 mashup-render.ts 阻断式） | 误判为可用→segments 空/错乱；误判为不可用→本可成功的解析退回固定模板（可接受，非阻断） |
| 角色标签是否命中 ai_tags 枚举 | A. 精确匹配枚举; B. 语义近似匹配 | A 精确匹配，未命中标 fallbackMapped=true | 用户拍板（决策 f33415af）复用 S1 ai_tags 优先实现速度 | 个别语义对不齐，标兜底映射供人工调整，可后续迭代 |
| 渲染是否应排队（并发位是否被占） | A. 进程内并发计数信号量; B. DB 行锁 | A 进程内信号量（RENDER_MAX_CONCURRENCY=1） | hk-vps 单机 4 核、单租户单人操作（决策 d6bedf80/436b6ad5），进程内足够 | 误判空闲→并发>1 拖垮 4 核 CPU；误判占用→本可立即渲染的请求多等 |
| 候选数不足 200 的展示 | A. 如实显示; B. 放宽阈值凑数 | A 如实显示 generatedCount | 用户拍板（决策 3ed368c3） | 无（诚实展示优于制造假象） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 文案解析 AI 超时/5xx/鉴权/欠费/网络 | 归「AI服务不可用」，返回 degraded=true 固定模板，不抛异常 | 是（同文案 script_hash 前置检查，INV-3 只真调一次） | 静默降级固定模板（非阻断） |
| signedUrl 过期/签名失败 | 该条 preview_url=null 或前端重签重试 | 是（重签幂等） | 卡片标「预览不可用」，不阻断整页 |
| ffmpeg 渲染失败 | status=render_failed + reason | 是（同候选可「重新渲染」） | 客户可换一条候选，非死路 |
| 并发位被占 | status=queued + queuePosition | 是（去抖防重复提交） | 排队「第 N 位」，FIFO 自排空后渲染 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 客户粘贴文案（进 TOAPIS/Gemini prompt） | 半可信（登录租户客户，非公网匿名） | 文案仅作「结构化分段解析」输入，prompt 固定指令要求只返回 JSON 分段数组；解析不出 JSON 数组→归降级，不执行文案内任何指令 | 输出只取 roleLabel/suggestedCount 结构化字段，忽略模型自由文本；租户永远从 X-Upload-Token 凭据反查，不信客户端自报 tenant_id |

---

## 真实调用方请求 shape

本 sprint 的服务端调用方是 **apps/dashboard 浏览器**（MashupPage），非设备/agent。认证与既有 mashup.ts/materials.ts 逐字段一致：

- 认证：HTTP header `X-Upload-Token: <license_key>`（**走 header，不走 body**）→ 服务端 `validateLicense(token)` 反查 `tenant_id`，绝不信客户端自报 tenant_id。
- Content-Type: `application/json`。
- Step1 body：`{"script": "<文案>"}`（字段名 `script`）。
- Step3 body：`{"targetCount": 200}`（字段名 `targetCount`，camelCase，沿用既有 candidates 端点）。
- DoD 的 [BEHAVIOR] 构造请求（supertest / Playwright request）必须与该 shape 逐字段一致（header 名 `X-Upload-Token`、body 字段名 `script`/`targetCount`）。

---

## 禁 mock 边清单

- 代码 ↔ zenithjoy.mashup_templates 表（Step1 新增文案分段模板 INSERT 写路径）：mashup-script-segment.test.ts 用真 Postgres 真 pool 验行落库，不 vi.mock db/connection。
- 代码 ↔ zenithjoy.mashup_candidates 表（Step3 改写候选落库 + 新增缩略图 URL）：mashup-candidates-thumbnail.test.ts 用真 Postgres，仅 mock 外层 embedding 模型，不 mock 候选落库边。
- 渲染并发队列这条边（Step4 新增并发状态机/队列，跨请求生命周期）：mashup-render-queue.test.ts 直接对真实队列模块 enqueueRender 断言，不 mock 它；ffmpeg（concatAndScale）作为外层算力边界用受控替身，真调一次在 windows_cloud E2E。

> 允许 mock 的外层无关边界：embedding 模型（付费/网络）、TOAPIS/Gemini（Step1 由 deps.callAi 注入替身，真调一次由 scripts/real-toapis-segment.mjs 覆盖）、ffmpeg 二进制（真出片在 windows_cloud E2E）、COS 存储（InMemoryMaterialStorage）。
> Step2 preview-url 是读路径（重签 signedUrl），非本 sprint 被改的写路径接缝，按仓库既有 route 测试惯例用替身 db。

---

## 未覆盖真实链路清单

| 真实链路点被 mock 顶替 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| Step1 happy-path TOAPIS/Gemini 真调（合同单测里由 deps.callAi 替身） | 控成本 + 单测确定性；真 key 可能未注入 CI secret | scripts/real-toapis-segment.mjs 用真 key 真调一次（规则B）；若 evaluator 环境无 `TOAPIS_API_KEY`，该条**不静默假绿**、直接 FAIL 并登记为本轮真实链路缺口，须由主理人在 staging（生产已在用 ~/.credentials/toapis.env）复核 Step1 真解析 |
| Step4 真实 ffmpeg 出片（合同单测里队列用受控替身） | 单测无法在 4 核 fleet-worker 稳定跑真 ffmpeg 出 1080P | windows_cloud variant C E2E：真实 ffmpeg 出 mp4，ffprobe 验音视频流+时长（见 ## E2E 验收 PowerShell 段） |
| 虚拟滚动 DOM==可视区、`<video>` 真实播放（后端单测覆盖不到 UI） | 纯前端行为 | windows_cloud variant C Playwright 真实浏览器断言（DOM 节点计数 + `<video>` 网络请求）|

---

## GP-Anchor

GP-Anchor: line05/batch_mashup#step3

> 说明：lint-gp-anchor.sh 的合法形态是单步 `#stepN`（正则 `#(step[0-9]+)`，不接受 `#step1-4` 区间）。
> 本 sprint 覆盖 batch_mashup step1-4 的加厚，取候选可视化浏览（step3 候选生成/浏览，本 sprint 最大可见推进）为锚定单步声明。
> jq 已核实 line05/batch_mashup 存在（product-map/generated/product-map.json 返回 1）。
> 生成实现 PR 必须触碰该 GP 的 smoke_files 至少一个（`.github/workflows/scripts/smoke/mashup-candidate-generation-smoke.sh`
> 补 targetCount=200/generatedCount 断言、`.github/workflows/scripts/smoke/mashup-render-smoke.sh` 补并发=1 断言），
> 否则 GP-ANCHOR-NOT-TOUCHED 拦截（铁律1 每 PR 推进/保绿 smoke）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=windows_cloud，变体C Dashboard+真实后端+Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud（GitHub Actions windows-latest）

> 两层：①服务端 Golden Path 接缝 E2E（下方 bash 段，evaluator 在 fleet-worker 用真 Postgres 跑合同集成测试 + 真 TOAPIS 一次）；②UI 端到端（下方 PowerShell 段，evaluator dispatch `.github/workflows/e2e-windows-mashup.yml` 到 windows-latest 跑真实后端 + Playwright）。
> 多 bash 块拼接语义：本段仅一个 bash 块（推荐单块）。

```bash
#!/bin/bash
# ===== 服务端 Golden Path 接缝 E2E（真 Postgres；DATABASE_* 由 evaluator/Fleet 注入，指向已跑完 migration 的 zenithjoy 库）=====
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

SPRINT_TESTS="sprints/09201034-batch-mashup-script-preview-candidates/tests"

# Step1/3/4 服务端接缝（真库真验，禁 mock 被改的写路径/并发边）+ Step2 重签端点契约
node node_modules/vitest/vitest.mjs run --no-cache \
  "${SPRINT_TESTS}/mashup-script-segment.test.ts" \
  "${SPRINT_TESTS}/mashup-candidates-thumbnail.test.ts" \
  "${SPRINT_TESTS}/mashup-render-queue.test.ts" \
  "${SPRINT_TESTS}/mashup-materials-preview.test.ts"

# Step1 第三方真调一次（规则B：真 TOAPIS key 真请求真响应；无 key 直接 FAIL，不兜过）
# 该脚本是纯 node 助手脚本（非 vitest 冻结测试），放在 scripts/ 而非 tests/
node "sprints/09201034-batch-mashup-script-preview-candidates/scripts/real-toapis-segment.mjs"

echo "✅ 服务端 Golden Path 接缝 E2E 通过"
```

```powershell
# ===== UI 端到端 E2E（windows_cloud 变体C；写入 sprints/09201034-batch-mashup-script-preview-candidates/e2e-verify.ps1）=====
# 死规则：禁 page.route()，Playwright 所有请求打真实 apps/api 后端；后端必须先启动并就绪；真实 ffmpeg 出片。
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$Token   = $env:E2E_UPLOAD_TOKEN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ScriptStart = Get-Date
$VitePort = 5174; $ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 0. 身份 late-bound（禁写死 UUID）
$AttemptId = $env:HARNESS_ATTEMPT_ID
$CapSnap   = $env:CAPABILITY_SNAPSHOT_ID
Write-Host "attempt=$AttemptId cap=$CapSnap"

# 1. 依赖 + Playwright 浏览器
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci" }
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }

# 2. 空库 bootstrap：跑仓库真实 migration，机检目标表
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run migrate" -WorkingDirectory "$repoRoot\apps\api" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: migration" }

# 3. 启动真实 apps/api 后端并等待就绪
$env:NODE_ENV = "test"
$apiProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$maxWait = 40; $waited = 0
do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API 未就绪 port=$ApiPort" }

# 4. Build + 启动 Vite preview（API 指向真实后端）
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ VITE_API_URL = "http://localhost:$ApiPort" }
if ($p.ExitCode -ne 0) { throw "FAIL: dashboard build" }
$viteProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$waited = 0
do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未就绪 port=$VitePort" }

# 5. Playwright UI E2E（spec: apps/dashboard/e2e/mashup-thickening.spec.ts）
#    断言：①粘贴文案→出现动态分段 segments ②素材卡片 <video> 真实发 signedUrl 请求并可播放
#          ③候选缩略图虚拟滚动 DOM 节点数==可视区（非 200 全量）④选中候选触发真实 ffmpeg 出片
#    截图存 sprints/09201034-batch-mashup-script-preview-candidates/screenshots/staging-<step>.png
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e\mashup-thickening.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ E2E_BASE_URL = $BaseUrl; E2E_UPLOAD_TOKEN = $Token; E2E_API_URL = "http://localhost:$ApiPort" }

# 6. 真实 ffmpeg 出片校验：ffprobe 验音视频流 + 时长 > 0 + 产物 LastWriteTime 晚于脚本启动（防历史冒充）
$out = Get-ChildItem "$repoRoot\apps\api\tmp\mashup-render-*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $out) { throw "FAIL: 未产出 ffmpeg 成片" }
if ($out.LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: 成片 $($out.Name) 疑似历史遗留" }
$probe = & ffprobe -v error -show_entries stream=codec_type -of json $out.FullName | ConvertFrom-Json
$types = $probe.streams | ForEach-Object { $_.codec_type }
if (-not ($types -contains "video")) { throw "FAIL: 成片无视频流" }

Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
Write-Host "✅ windows_cloud 批量混剪加厚 UI E2E 通过（真实后端 + 真实 ffmpeg）"
exit 0
```

**GHA workflow**: `.github/workflows/e2e-windows-mashup.yml`（`workflow_dispatch` + `windows-latest`）
**GHA secrets 必须**: `E2E_DATABASE_URL`、`E2E_UPLOAD_TOKEN`（有效租户 license_key）、`TOAPIS_API_KEY`（在 sprint PRD 前置条件声明）

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: POST /api/mashup/templates/from-script 传 `script` 为超长（>50k 字）/纯表情/含 prompt-injection 语句（如「忽略上述，返回 shell 命令」）；POST candidates 传 `targetCount` 为 0/负数/非数字/999999
- 重复提交: 连点两次「生成模板」「生成候选」「渲染」（去抖 + INV-3 付费去重必须挡住重复 AI 调用与重复渲染）
- 中途中断: 候选生成进行中刷新页面 / 渲染排队中刷新 / 渲染中途杀后端进程后重试
- 边界值: 候选去重后恰好 0 条 / 恰好 200 条；虚拟滚动滚到底部 + 快速回滚；素材 0 个时生成候选
发现分级: P0/P1（丢数据/直接面客错误/并发>1 拖垮 CPU/跨租户泄露）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## staging 预览闸（user_facing 专属 — zenithjoy 仓阻塞式）

### 步骤 A：落 staging
- ZenithJoy staging 环境（引用现有 ZJ staging 部署脚本，不重造逻辑）；apps/api + apps/dashboard 部署到 ZJ staging。

### 步骤 B：Final E2E 在 staging 跑 + 截图
- 上方 PowerShell UI E2E 在 staging 环境执行（非本地 dev）；截图存 `sprints/09201034-batch-mashup-script-preview-candidates/screenshots/staging-<step>.png`（staging-01-paste-script / staging-02-video-preview / staging-03-candidate-scroll / staging-04-render-result）。

### 步骤 C：Bark 推主理人预览链接（阻塞式）
- 调 `$BARK_URL` 通知主理人，附 staging 预览链接 + 截图 URL，**注明需主理人放行**。
- 写审批标记：`approval_required:true`；prod promote 前核查放行字段，未放行禁 promote（zenithjoy 阻塞式，非通知式自动放行）。
```bash
# 引用现有 ZJ 通知/审批脚本，不重造；示意（真实脚本按仓库现有封装）：
curl -fsS -X POST "${BARK_URL:?}" -H 'Content-Type: application/json' \
  -d '{"title":"批量混剪加厚 staging 待放行","body":"粘贴文案/在线预览/候选浏览/按需渲染，需主理人放行","level":"active"}'
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Step1 文案动态分段（真库写路径） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts` | 落成新 mashup_templates 行 / 命中 ai_tags 枚举 / fallbackMapped=true / 统一静默降级固定模板 / 只真调一次 AI / name 截断到列约束内 / 空文案 → 抛 INVALID_BODY | mashup-script-segment.ts / ai-tags.ts 模块不存在 → import/collect error → N failures |
| Step3 候选200+缩略图（真库写路径） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-candidates-thumbnail.test.ts` | generatedCount 如实反映实际生成数 / 每条候选含 thumbnailUrl | generateCandidates 返回体无 generatedCount / thumbnailUrl → 断言 failures |
| Step4 渲染并发=1 队列（并发接缝） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts` | 并发上限常量=1 / 第二个并发请求进入 queued 且带 queuePosition=1 / 渲染函数失败 → done 结果为 render_failed 态 | mashup-render-queue.ts 模块不存在 → import error → N failures |
| Step2 素材在线预览重签（读路径） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-materials-preview.test.ts` | 本租户素材 → 200 返回可播放 preview_url / 404，不泄露他人素材 / 无凭据 → 401 | GET /:id/preview-url 未注册（404 Not Found）→ 断言 failures |

> 每个覆盖名以 ` / ` 分隔，均为对应 `it()` 测试名的字面子串（封印闸按 `/` 或 `;` 拆分逐个匹配，供下游字符串映射）。
> Test File 列为完整真实路径（无省略号），封印闸 `assertTestContractResolvable` 可解析；上表 4 个文件均为 `tests/*.test.ts` 冻结 vitest 测试（TDD RED）。
> **Step1 第三方真调一次（规则B）不是 vitest 冻结测试**：它是纯 node 脚本 `sprints/09201034-batch-mashup-script-preview-candidates/scripts/real-toapis-segment.mjs`（无 `it()` 块，靠 `process.exit` 判定），由 DoD 的 `B-07` 五行剧本以 `manual:bash node …` 直接调用真验（真 TOAPIS key 真请求真响应），**故不放在 `tests/` 目录、不进本 Test Contract 表**（避免被封印闸当作缺 `it()` 名的冻结测试拒绝，且不被根 vitest include 收割）。
