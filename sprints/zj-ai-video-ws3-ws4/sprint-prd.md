# Sprint PRD — AI 视频 Pipeline WS3 比例选择/画幅检测 + WS4 Agent v1.1.29 bump

## OKR 对齐

- **对应 KR**：Line 05 视频剪辑 — AI 视频 Pipeline
- **当前进度**：WS1 (original_script) PR #501 ✅ 已合并；WS2 (HTML Builder) PR #496 ✅ 已合并
- **本次推进预期**：完成 比例选择/画幅检测 + Agent 版本升级与 E2E 全链路验收

## 背景

WS1（original_script）与 WS2（三模板 HTML Builder）已合并。本 sprint 补跑剩余两个 WS，完成 AI 视频 Pipeline 的画幅检测、比例选择逻辑，以及 Agent v1.1.29 版本升级与 E2E 验收。

## Golden Path（核心场景）

**WS3 — 比例选择 + 画幅检测**

用户在 LocalVideoPipelinePage（`apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`）选择比例 → POST createJob 携带 `target_aspect` → Agent ffprobe 读 `vStream.width`/`height` + rotation → PATCH progress 写回 `detected_aspect` → effectiveTarget 只生成单文件

具体：
1. 前端比例选择器呈现三项：竖版 9:16 / 横版 16:9 / 自动检测（默认）；提交时携带 `target_aspect`（null 表示自动）
2. Agent `services/agent/src/handlers/video-pipeline.ts` Step 1 ffprobe `-show_streams`：rotation=90°/270° 时 swap effectiveWidth↔effectiveHeight；effectiveWidth < effectiveHeight → `detectedAspect="9:16"`；否则 `"16:9"`
3. PATCH `/api/ai-video-pipeline/:jobId/progress` 写回 `detected_aspect` 至 DB
4. Step 7B：`effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"`；只生成对应单文件（`9_16.mp4` 或 `16_9.mp4`）

**WS4 — Agent v1.1.29 bump + E2E spec 更新**

`services/agent/package.json` 版本升至 `1.1.29` → `e2e/agent-video-pipeline.spec.js` 补充 original_script + W-G + 9:16 + detected_aspect 断言 + 截图 → GHA `agent-e2e-video.yml` default version 改为 1.1.29 → agent-installpack.yml 触发新包构建

## Response Schema

### DB migration（WS3 前置）

`zenithjoy.ai_video_pipeline_jobs` 新增两列（WS1 migration 已加 original_script，本 sprint 复核）：
- `target_aspect TEXT`（用户选择，可 null）
- `detected_aspect TEXT`（ffprobe 写回，可 null）

### PATCH /api/ai-video-pipeline/:jobId/progress（Agent 内部写回）

**Request Body（追加字段）**：
- `detected_aspect` (string, 可选): `"9:16"` | `"16:9"`

**Success (HTTP 200)**：
```json
{"ok": true}
```

**禁用响应字段名**：`aspectRatio` / `aspect` / `ratio` / `orientation`

### GET /api/ai-video-pipeline/:jobId（E2E 断言用）

**Success (HTTP 200)**：
```json
{"job": {"id": "<uuid>", "detected_aspect": "9:16", "status": "completed"}}
```
- `detected_aspect` 完成后必须有值（非 null）

**禁用字段变体**：`detectedAspect`（响应必须 snake_case）

## 边界情况

- rotation=90°/270° (iPhone 竖拍)：swap 后 effectiveWidth < effectiveHeight → `"9:16"`
- `target_aspect=null`：effectiveTarget 回落到 `detectedAspect ?? "9:16"`
- ffprobe 失败：`detectedAspect` 为 null，effectiveTarget 最终兜底 `"9:16"`

## 范围限定

**在范围内**：DB migration（target_aspect + detected_aspect）；API PATCH 写回；前端比例选择器；Agent ffprobe 画幅检测 + effectiveTarget 单文件生成；E2E spec 更新；Agent v1.1.29 bump；GHA workflow default 更新
**不在范围内**：WS1（PR #501 已完成）；WS2（PR #496 已完成）；多画幅批量生成；多模板同时输出；session_token 自动管理

## 假设

- [ASSUMPTION: DB migration 目标表 `zenithjoy.ai_video_pipeline_jobs` 已在 WS1 migration 中创建，本 sprint 追加两列]
- [ASSUMPTION: GHA Secret `ZENITHJOY_LICENSE=ZJ-F-FBFYTLFR` 已就绪]
- [ASSUMPTION: session_token 通过 workflow_dispatch input 手动传入]
- [ASSUMPTION: COS 测试视频（rotation=90° iPhone 竖拍）可用于 ffprobe 验证]

## 预期受影响文件

- `apps/api/db/migrations/…_add_aspect_to_video_jobs.sql`: DB migration 加两列
- `apps/api/src/controllers/ai-video-pipeline.controller.ts`: createJob 接受 target_aspect
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`: 比例选择器 UI + createJob 携带 target_aspect
- `services/agent/src/handlers/video-pipeline.ts`: ffprobe 画幅检测 + effectiveTarget 逻辑
- `e2e/agent-video-pipeline.spec.js`: E2E 补充步骤 + detected_aspect 断言
- `services/agent/package.json`: version → 1.1.29
- `.github/workflows/agent-e2e-video.yml`: default version → 1.1.29

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端 UI（比例选择器）+ Windows ZenithJoy Agent E2E，起点为用户 UI 操作
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent E2E 走 GitHub Actions windows-latest runner（干净 sandbox，agent-e2e-video.yml）
