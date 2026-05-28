# Sprint PRD — AI 视频 Pipeline WS3+WS4（比例选择画幅检测 + Agent v1.1.32 + E2E）

## OKR 对齐

- **对应 KR**：Line 05 视频剪辑 — AI 视频 Pipeline
- **当前进度**：WS1（original_script，PR #501）已合并，WS2（HTML Builder，PR #496）已合并
- **本次推进预期**：比例选择画幅检测 + Agent version bump + E2E spec 覆盖新功能 → Pipeline 全链路可用

## 背景

前一个 initiative（1e9b07eb）因 watchdog 中断而失败，WS1（PR #501）和 WS2（PR #496）已单独 merge。
本 sprint 补跑剩余的 WS3（比例选择 + 画幅检测）和 WS4（Agent bump + E2E spec 更新），Agent 当前版本 1.1.31，本次 bump 到 1.1.32。

## Golden Path（核心场景）

**WS3 — 比例选择 + 画幅检测**

用户在前端 LocalVideoPipelinePage 从 [选择比例（9:16 / 16:9 / 自动检测）] → 经过 [Agent ffprobe 读取视频 width/height/rotation，计算 detectedAspect，PATCH 写回 DB，effectiveTarget 决定只生成一个文件] → 到达 [正确画幅文件生成，job.detected_aspect 有值]

具体：
1. 前端比例选择器：竖版 9:16 / 横版 16:9 / 自动检测（默认），createJob 携带 `target_aspect`
2. Agent Step 1：ffprobe `-show_streams` 读 `vStream.width` / `vStream.height` / rotation；rotation=90°/270° 时 swap → effectiveWidth/effectiveHeight
3. effectiveWidth < effectiveHeight → `detectedAspect = "9:16"`；否则 `"16:9"`
4. PATCH `/api/ai-video-pipeline/:jobId/progress` 写回 `detected_aspect`
5. Agent Step 7：`effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"`，只生成对应一个文件（9_16.mp4 或 16_9.mp4）

**WS4 — Agent v1.1.32 + E2E spec 更新**

1. `services/agent/package.json` version → `1.1.32`
2. `e2e/agent-video-pipeline.spec.js` 补充：填写 original_script textarea → 点模板 W-G 按钮 → 点比例竖版 9:16 → 等待 job 完成 → API 验证 `job.detected_aspect` 有值 → 截图
3. `agent-installpack.yml` 因 `services/agent/**` push 自动触发 build → COS 上传 → manifest 更新
4. `agent-e2e-video.yml`（Final E2E）在 windows-latest runner 跑更新后 spec

## Response Schema

### PATCH /api/ai-video-pipeline/:jobId/progress

**Request Body（新字段）**：
- `detected_aspect` (string, 可选): `"9:16"` 或 `"16:9"`

**Success (HTTP 200)**：
```json
{"ok": true}
```
- **禁用响应字段名**：`aspectRatio`/`aspect`/`ratio`/`orientation`（generator 不得自由发挥）

### GET /api/ai-video-pipeline/:jobId（验收用）

**Success (HTTP 200) — 相关字段**：
```json
{
  "job": {
    "id": "<uuid>",
    "detected_aspect": "9:16",
    "target_aspect": "<string|null>"
  }
}
```
- `detected_aspect` 必须在 ffprobe 完成后有值（非 null）
- **禁用字段名变体**：`detectedAspect`（必须 snake_case）

## 边界情况

- rotation=90°/270°（iPhone 录制）：必须 swap width↔height 后判横竖，`detectedAspect="9:16"`
- `target_aspect=null`（自动检测）：`effectiveTarget = detectedAspect ?? "9:16"`
- `target_aspect="9:16"`：忽略 detectedAspect，只生成 9_16.mp4
- `target_aspect="16:9"`：只生成 16_9.mp4
- ffprobe 失败时：PATCH 不写 detected_aspect，effectiveTarget 降级到 "9:16"

## 范围限定

**在范围内**：
- 前端 LocalVideoPipelinePage 比例选择器 + createJob 携带 target_aspect
- Agent video-pipeline.ts Step 1 ffprobe 画幅检测 + PATCH 写回
- Agent Step 7 effectiveTarget 只生成单文件
- PATCH /api/ai-video-pipeline/:id/progress 接受并写 detected_aspect
- `services/agent/package.json` version → 1.1.32
- `e2e/agent-video-pipeline.spec.js`：补充比例选择 + detected_aspect 验证
- `agent-installpack.yml` + `agent-e2e-video.yml` GHA 触发

**不在范围内**：
- WS1（original_script）— 已 merge PR #501
- WS2（HTML Builder 三模板）— 已 merge PR #496
- 多画幅批量生成（同时输出 9:16 + 16:9）
- 多模板同时输出

## 假设

- [ASSUMPTION: services/agent 当前版本 1.1.31，本次 bump 到 1.1.32（PrepPRD 中目标 1.1.29 已过时）]
- [ASSUMPTION: GHA Secret ZENITHJOY_LICENSE=ZJ-F-FBFYTLFR 已就绪]
- [ASSUMPTION: COS 测试视频 zj-e2e-koubo-45s.mp4 已存在]
- [ASSUMPTION: session_token 在 Final E2E 前通过 workflow_dispatch input 手动传入]
- [ASSUMPTION: PATCH /api/ai-video-pipeline/:id/progress 端点已存在，只需加 detected_aspect 字段处理]

## 预期受影响文件

- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`：比例选择器 UI + createJob 携带 target_aspect
- `services/agent/src/handlers/video-pipeline.ts`：ffprobe 画幅检测（rotation swap）+ PATCH 写回 + effectiveTarget
- `apps/api/src/`: PATCH progress 接受 detected_aspect 写 DB
- `services/agent/package.json`：version → 1.1.32
- `e2e/agent-video-pipeline.spec.js`：补充比例选择 + W-G + detected_aspect 验证 + 截图
- `.github/workflows/agent-installpack.yml`：自动触发（无需改）
- `.github/workflows/agent-e2e-video.yml`：引用更新后 spec（default version 改 1.1.32）

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard 前端比例选择器 UI + Windows Electron Agent E2E，起点为用户 UI 操作
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent E2E 在 GitHub Actions windows-latest runner 执行（agent-e2e-video.yml），ZenithJoy 产品为 Windows 平台
