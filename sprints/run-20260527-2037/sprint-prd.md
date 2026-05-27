# Sprint PRD — AI 视频 Pipeline：模板真实渲染 + 原始文案 + 画幅检测

## OKR 对齐

- **对应 Journey**：Line 01 智能发布
- **当前问题**：模板 HTML 与 JSX 视觉不一致、缺 original_script 字段、非模板路径强制双文件输出
- **本次推进**：WS1~WS4 全部完成后 GHA Windows E2E 绿灯 = 本 Sprint 完成

---

## 背景

三个根本问题阻碍真实视频发布效果：
1. `_buildDynamicTemplateHtml` 对所有模板输出同一布局（只换调色板），JSX 模板（WG/C/R）定义的真实视觉结构完全未被使用
2. 创建 job 时缺 `original_script` 字段；ASR 转写 + 原始文案对比能显著提升 Claude 场景文案质量
3. ffprobe Step 1 只取 `videoRotation` 未取 `width/height`，无法判断真实画幅，导致非模板路径强制生成 9_16.mp4 + 16_9.mp4 两个文件

---

## Golden Path（核心场景）

用户从 **Dashboard 本地视频页** → 填写原始文案（可选）+ 选模板 + 选画幅 → 提交 job → **收到单个目标画幅视频**，模板视觉与 JSX 设计一致。

具体步骤：

1. **触发**：用户在 `LocalVideoPipelinePage` 上传视频，填写 `original_script`（可选），点击模板按钮（W-G / C / R），选择画幅（9:16 / 16:9 / 自动检测），提交
2. **系统处理 — 创建 Job**：API 接收 `original_script` + `target_aspect`，写入 `ai_video_pipeline_jobs`
3. **系统处理 — ffprobe 检测**：Agent Step 1 读取视频 `width/height`（rotation=90°/270° 时 swap），计算 `detectedAspect`，PATCH 写回 DB 的 `detected_aspect` 字段
4. **系统处理 — 模板 HTML 生成**：`compose-template` API 按 `templateId` 分发到 `_buildWGHtml` / `_buildCHtml` / `_buildRHtml` 三个专属函数，生成与 JSX 视觉一致的 HTML
5. **系统处理 — 视频输出**：Agent 取 `effectiveTarget = target_aspect ?? detectedAspect ?? "9:16"`，只生成对应一个文件
6. **可观测结果**：Dashboard 显示 job 状态 `completed`，`detected_aspect` 有值，输出视频为目标画幅，模板视觉（颜色/布局/字体）与 JSX 一致

---

## Response Schema

### POST /api/ai-video-pipeline/（创建 job）

**Request Body 新增字段**：
- `original_script` (string, 可选): 用户录制前参考文案
- `target_aspect` (string, 可选): `"9:16"` / `"16:9"` / 不传(null = 自动检测)

**Success (HTTP 201)**:
```json
{
  "id": "<uuid>",
  "status": "pending",
  "original_script": "<string or null>",
  "target_aspect": "<string or null>",
  "detected_aspect": null
}
```
- `original_script` (string | null, 必返): 传入值原样存储
- `target_aspect` (string | null, 必返): `"9:16"` / `"16:9"` / `null`
- `detected_aspect` (null 初始): ffprobe 完成后由 PATCH 写入

**禁用字段名**: `aspectRatio`/`aspect_ratio`/`script`/`raw_script`/`source_script`

---

### GET /api/ai-video-pipeline/:id（查询 job）

**Success (HTTP 200)**:
```json
{
  "id": "<uuid>",
  "status": "completed",
  "original_script": "<string or null>",
  "target_aspect": "<string or null>",
  "detected_aspect": "9:16"
}
```
- `detected_aspect` (string | null): ffprobe 结果，`"9:16"` 或 `"16:9"`
- **Schema 完整性**: 顶层必含 `original_script`、`target_aspect`、`detected_aspect`（即使 null）

---

### POST /api/ai-video-pipeline/:id/compose-template（模板 HTML 生成）

**Request Body**:
- `templateId` (string, 必填): `"W-G"` / `"C"` / `"R"`
- `target_aspect` (string, 可选): 传给模板函数决定尺寸

**Success (HTTP 200)**:
```json
{
  "html": "<string>",
  "aspect": "9:16"
}
```
- `html` (string, 必填): 渲染好的 HTML 字符串
- `aspect` (string, 必填): `"9:16"` (W-G) / `"16:9"` (C 或 R)
- **禁用字段名**: `content`/`template`/`result`/`output`/`ratio`

---

## 边界情况

- iPhone 视频（1920×1080 + rotation=90°）→ effectiveWidth=1080 < effectiveHeight=1920 → `detectedAspect = "9:16"`
- `target_aspect = null` 且 ffprobe 未完成时 → Agent 等待 `detected_aspect` 写入后再决定输出格式
- `original_script` 为空字符串 → 等同于 null，不注入 Claude prompt
- `templateId` 不在 W-G/C/R 内 → API 返回 400

---

## 范围限定

**在范围内**：
- DB migration 加 `original_script`、`target_aspect`、`detected_aspect` 字段
- `_buildWGHtml` / `_buildCHtml` / `_buildRHtml` 三个专属 HTML 生成函数
- ffprobe 补充读取 `width/height` + `detectedAspect` 计算 + PATCH 写回
- Agent 非模板路径只生成单个文件
- `LocalVideoPipelinePage` 加 `original_script` textarea + 画幅选择器
- `e2e/agent-video-pipeline.spec.js` 更新（填 original_script + 选 W-G + 选 9:16）
- Agent `package.json` version bump → v1.1.29
- GHA `agent-installpack.yml` + `agent-e2e-video.yml` 触发/验收

**不在范围内**：
- 第 4 套模板
- `original_script` 历史记录展示 UI
- 多号矩阵/批量视频

---

## 假设

- [ASSUMPTION: GHA Secret `ZENITHJOY_LICENSE=ZJ-F-FBFYTLFR` 已存在]
- [ASSUMPTION: COS 测试视频 `zj-e2e-koubo-45s.mp4` 已存在，可由 workflow 下载]
- [ASSUMPTION: `session_token` 通过 `workflow_dispatch input` 手动传入，不在代码库中]
- [ASSUMPTION: PATCH detected_aspect 复用现有 progress 端点或新增专属端点，由 Proposer 在合同中确定]
- [ASSUMPTION: compose-template 调用时 templateId 由 Agent 从 job 记录读取，非前端实时传入]

---

## 预期受影响文件

- `apps/api/db/migrations/` — 新增 migration SQL（original_script、target_aspect、detected_aspect 三列）
- `apps/api/src/services/ai-video-pipeline.service.ts` — `createJob()` 接受新字段
- `apps/api/src/controllers/ai-video-pipeline.controller.ts` — createJob 读 original_script + target_aspect
- `apps/api/src/controllers/ai-video-pipeline-ai.controller.ts` — `_buildDynamicTemplateHtml` 拆三函数 + composeTemplate 注入 original_script
- `apps/api/src/templates/template-wg.jsx` / `template-c.jsx` / `template-r.jsx` — 提供视觉规格参考（不直接改动）
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx` — original_script textarea + 画幅选择器
- `services/agent/package.json` — version → v1.1.30
- `services/agent/src/` — ffprobe 补充 width/height + 单文件输出逻辑
- `e2e/agent-video-pipeline.spec.js` — 更新 E2E spec
- `.github/workflows/agent-installpack.yml` — 触发 WS4 build
- `.github/workflows/agent-e2e-video.yml` — Final E2E 验收

---

## journey_type: user_facing
## journey_type_reason: 涉及 Dashboard 前端交互（LocalVideoPipelinePage）+ Agent 视频输出，起点为用户 UI 操作
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent 是 Windows 产品，Final E2E 在 GitHub Actions windows-latest runner 跑 Playwright（GHA 干净 VM）
