# Sprint PRD — AI 视频 Pipeline 模板真实渲染 + 原始文案 + 比例选择

## OKR 对齐

- **对应 KR**：Line 05 视频剪辑 — Pipeline 功能完整性 & 输出质量
- **当前进度**：待 Brain 上下文确认
- **本次推进预期**：4 个 WS 完成后，Pipeline 具备模板真实渲染、原始文案 Claude 注入、智能画幅选择三项核心能力

## 背景

AI 视频 Pipeline 存在三个根本问题导致产出质量低：

1. `_buildDynamicTemplateHtml` 对所有模板输出同一布局仅换色板，JSX 文件（template-wg / template-c / template-r）定义的真实视觉结构完全未被使用
2. Job 创建和 compose-template 缺少 `original_script` 字段，ASR 转写与用户录制前参考文案无法关联，Claude 场景文案上下文不足
3. 非模板路径强制生成 `9_16.mp4` + `16_9.mp4` 两个文件；ffprobe Step 1 只读 `videoRotation` 未读 `width/height`，无法判断视频真实画幅

## Golden Path（核心场景）

用户从 [LocalVideoPipelinePage 填写原始文案 → 选模板 W-G → 选比例 9:16 → 提交] → 经过 [Job 写库含 original_script + Agent ffprobe 检测画幅写 detected_aspect → compose-template 调用 _buildWGHtml 生成竖版 HTML → Claude prompt 含原始文案 → 单文件 9_16.mp4 输出] → 到达 [GHA Windows E2E Playwright green + 截图证明模板选中 + 比例选中 + 完成状态]

具体步骤：
1. 用户在 `original_script` textarea 填写"ZenithJoy E2E 原始文案测试"
2. 用户点击模板 W-G 按钮，点击比例 9:16 按钮
3. POST /api/ai-video-pipeline/ 创建 job，`original_script` + `target_aspect` 写入 DB
4. Agent ffprobe 读 `width/height`（含 rotation swap），计算 `detectedAspect`，PATCH 写回 `detected_aspect`
5. compose-template 调用 `_buildWGHtml()`，返回 1080×1920 竖版 HTML，`aspect: "9:16"`
6. Claude prompt 前缀含"用户录制前参考文案（非逐字稿，仅意图参考）：…"
7. 非模板路径：`effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"`，只生成 `9_16.mp4`，删除强制双文件逻辑
8. GHA Windows E2E artifact 上传截图，run green = 验收通过

## Response Schema

### Endpoint: POST /api/ai-video-pipeline/

**Request Body 新增字段**:
- `original_script` (string, 可选): 用户录制前参考文案，写入 `original_script` 列
- `target_aspect` (string, 可选): `"9:16"` | `"16:9"` | null（null = 自动检测）

**Success (HTTP 201)**:
```json
{"id": "<uuid>", "status": "pending", "original_script": "<string|null>", "target_aspect": "<string|null>"}
```
- `id` (string, 必填): job UUID
- `original_script` (string|null, 必填): 写入值，原样返回
- `target_aspect` (string|null, 必填): 写入值，原样返回
- 禁用字段名: `script`/`raw_script`/`source_script`/`input_script`

### Endpoint: GET /api/ai-video-pipeline/{id}

**Success (HTTP 200)**:
```json
{"id": "<uuid>", "status": "completed", "detected_aspect": "9:16", "original_script": "<string|null>", "target_aspect": "<string|null>"}
```
- `detected_aspect` (string, 必填 — ffprobe 完成后): `"9:16"` | `"16:9"`
- 禁用字段名: `aspect`/`video_aspect`/`aspectRatio`/`videoAspect`

### Endpoint: POST /api/ai-video-pipeline/{id}/compose-template

**Success (HTTP 200)**:
```json
{"html": "<string>", "aspect": "9:16"}
```
- `aspect` (string, 必填): `"9:16"` | `"16:9"`，与所选模板对应
- 禁用字段名: `ratio`/`aspectRatio`/`format`/`orientation`

**Schema 完整性**:
- WS1 unit test：POST body 含 `original_script` → GET job 返回 `original_script` 字段值相等
- WS3 unit test：iPhone 竖拍视频（1920×1080 + rotation=90°）→ `detected_aspect = "9:16"`

## 边界情况

- `original_script = null` → Claude prompt 不注入原始文案片段，正常生成
- ffprobe 读取失败 → `detectedAspect` 默认 `"9:16"`，继续流程不报错
- `target_aspect = null` → `effectiveTarget = detectedAspect ?? "9:16"`
- 模板路径（有 `template_id`）→ 已正确只生成 templateAspect 对应文件，不在本 sprint 改动
- rotation 非 0/90/180/270 → 按原始 width/height 判断，不 swap

## 范围限定

**在范围内**：
- WS1：`original_script` DB 列 + createJob API + 前端 textarea + Claude prompt 注入
- WS2：`_buildWGHtml` / `_buildCHtml` / `_buildRHtml` 三套专属 HTML 函数 + `_buildDynamicTemplateHtml` switch 分发
- WS3：ffprobe 读 `width/height` + `detectedAspect` 写库 + `target_aspect` 字段 + 非模板路径单文件输出 + 前端比例选择器
- WS4：Agent v1.1.29 version bump + E2E spec 更新 + GHA Windows 真实视频验收 (agent-e2e-video.yml)

**不在范围内**：
- 第 4 套模板
- template-r.jsx 像素级完美还原（先做色调 + 三栏结构）
- original_script 在历史记录页展示（下一个 sprint）
- 多文件/多模板批量处理

## 假设

- [ASSUMPTION: ai_video_pipeline_jobs 表使用 Knex migration 或同类 SQL 迁移工具，可 addColumn]
- [ASSUMPTION: compose-template 端点已存在，WS2 仅改函数内部实现，不改端点签名]
- [ASSUMPTION: GHA Secret ZENITHJOY_LICENSE=ZJ-F-FBFYTLFR 已配置]
- [ASSUMPTION: session_token 通过 agent-e2e-video.yml workflow_dispatch input 传入]
- [ASSUMPTION: COS 测试视频 zj-e2e-koubo-45s.mp4 已存在可下载]
- [ASSUMPTION: _buildWGHtml 色板以 PrepPRD 描述为准（#ede4d2 底 / #1f3a3d stripe / #d39c4a mustard），不以 JSX 像素级为准]

## 预期受影响文件

- `packages/api/src/services/aiVideoPipelineService.ts`: createJob 接受 originalScript
- `packages/api/src/controllers/aiVideoPipelineController.ts`: 读 original_script + target_aspect
- `packages/api/src/controllers/composeTemplateController.ts`: prompt 注入 original_script
- `packages/api/src/services/templateHtmlBuilder.ts`（或同路径）: 三套 HTML 函数 + switch
- `packages/api/migrations/`: 2 列 migration（original_script + target_aspect + detected_aspect）
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`: original_script textarea + 比例选择器
- `services/agent/src/workers/aiVideoWorker.ts`（或同路径）: ffprobe width/height + detectedAspect + 单文件输出
- `services/agent/package.json`: version → 1.1.29
- `e2e/agent-video-pipeline.spec.js`: E2E spec 更新（original_script + W-G + 9:16 + 验证）

## journey_type: user_facing
## journey_type_reason: 涉及 LocalVideoPipelinePage 前端新增字段 + 用户比例选择交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent 视频 Pipeline E2E 走 GitHub Actions windows-latest runner（agent-e2e-video.yml），真实视频验收，PrepPRD 显式标注 target_environment: windows_cloud
