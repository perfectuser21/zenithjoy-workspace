# Sprint PRD — AI 视频 Pipeline 补跑（WS1 original_script + WS2 比例选择/画幅检测 + WS3 Agent v1.1.29 bump）

## OKR 对齐

- **对应 KR**：Line 05 视频剪辑 — AI 视频 Pipeline
- **当前进度**：WS2（三模板 HTML Builder）已合并 PR #496
- **本次推进预期**：补跑 original_script 字段、比例选择画幅检测、Agent v1.1.29 bump

## 背景

initiative 96db2647 因 watchdog 中断，WS2（HTML Builder，PR #496）已手动 merge。
本 sprint 补跑剩余 3 个 WS，完成 AI 视频 Pipeline 的 original_script 注入、画幅检测+比例选择、Agent 版本升级与 E2E 验收。

## Golden Path（核心场景）

**WS1 — original_script 字段**

1. 用户在前端 LocalVideoPipelinePage 的"原始文案（可选）"textarea 填入文案
2. POST /api/ai-video-pipeline/ 携带 `original_script`，服务写入 DB（新 TEXT 列）
3. composeTemplate 读取 `job.original_script`，有值时在 Claude prompt 前缀注入"用户录制前参考文案（非逐字稿，仅意图参考）："

**WS2 — 比例选择 + 画幅检测**

1. ffprobe `-show_streams` 读 `vStream.width` / `vStream.height` / rotation，rotation=90°/270° 时 swap 得 effectiveWidth/Height
2. effectiveWidth < effectiveHeight → `detectedAspect = "9:16"`；否则 `"16:9"`；PATCH progress 写回 DB
3. 用户在前端选竖版 9:16 / 横版 16:9 / 自动检测（默认）；createJob 接受 `target_aspect`
4. Agent 按 `effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"` 只生成对应一个文件

**WS3 — Agent v1.1.29 bump + E2E 更新**

1. services/agent `package.json` version 升至 `1.1.29`
2. E2E spec 补充：填 original_script textarea → 点 W-G 模板按钮 → 选 9:16 → 等待完成 → API 验证 `job.detected_aspect` 有值 + `status=completed` → 截图
3. 触发 agent-installpack.yml（GHA build → COS 上传 → manifest 更新）；Final E2E：agent-e2e-video.yml windows-latest runner 跑更新后 spec

## Response Schema

### POST /api/ai-video-pipeline/（createJob）

**Request Body 新字段**：
- `original_script` (string, 可选): 原始文案
- `target_aspect` (string, 可选): `"9:16"` | `"16:9"` | `null`（自动检测）

**Success (HTTP 201)**：
```json
{
  "job": {
    "id": "<uuid>",
    "original_script": "<string|null>",
    "target_aspect": "<string|null>",
    "detected_aspect": "<string|null>"
  }
}
```
- 禁用字段变体：`originalScript`（响应必须 snake_case）
- `detected_aspect` 初始可为 null（ffprobe 完成后写回）

### PATCH /api/ai-video-pipeline/:jobId/progress（Agent 内部）

写回 `detected_aspect`：`"9:16"` 或 `"16:9"`

**禁用响应字段名**：`aspectRatio`/`aspect`/`ratio`/`orientation`（generator 不得自由发挥）

## 边界情况

- rotation=90°/270°：必须 swap width↔height 后再判横竖（iPhone 录制竖版视频 → detected_aspect="9:16"）
- `original_script` 为 null/空字符串：composeTemplate 不注入前缀，prompt 不变
- `target_aspect=null`：effectiveTarget = `detectedAspect ?? "9:16"`

## 范围限定

**在范围内**：DB migration（3 字段）、API 读写新字段、前端 2 个新控件、ffprobe 画幅检测、Agent effectiveTarget 逻辑、E2E spec 更新、Agent version bump、agent-installpack + Final E2E GHA
**不在范围内**：WS2（HTML Builder，已 merge #496）、多画幅批量生成、多模板同时输出

## 假设

- [ASSUMPTION: GHA Secret ZENITHJOY_LICENSE=ZJ-F-FBFYTLFR 已就绪]
- [ASSUMPTION: COS 测试视频 zj-e2e-koubo-45s.mp4 已存在]
- [ASSUMPTION: session_token 在 Final E2E 前通过 workflow_dispatch input 手动传入]
- [ASSUMPTION: composeTemplate 已有 Claude prompt 构造逻辑，WS1 只做注入扩展]

## 预期受影响文件

- `apps/api/src/migrations/`: 新增 migration（original_script + target_aspect + detected_aspect 三列）
- `apps/api/src/services/ai-video-pipeline.service.ts`: createJob 接受并写入 original_script + target_aspect
- `apps/api/src/controllers/ai-video-pipeline.controller.ts`: 读取 req.body 新字段；composeTemplate 注入 original_script
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`: 加 original_script textarea + 比例选择器
- `services/agent/src/`: ffprobe 读 width/height/rotation，计算 detectedAspect，写回 PATCH；effectiveTarget 只生成一文件
- `services/agent/package.json`: version → `1.1.29`
- `services/agent/e2e/agent-video-pipeline.spec.js`: 补充新步骤 + API 验证
- `.github/workflows/agent-installpack.yml`: 触发 build（version bump 后自动）
- `.github/workflows/agent-e2e-video.yml`: Final E2E spec 引用更新后 spec

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard 前端 UI 控件（textarea + 比例选择器）+ Windows Electron Agent E2E
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent E2E 在 GitHub Actions windows-latest runner 执行（agent-e2e-video.yml），PrepPRD 明确指定
