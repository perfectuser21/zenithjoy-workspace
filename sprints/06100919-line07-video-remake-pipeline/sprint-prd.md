# Sprint PRD — Line 07 AI爆款视频翻拍：9节点可视化流水线（thin）

## OKR 对齐

- **对应 KR**：Line 07 — AI爆款视频翻拍（首个可验收 E2E）
- **当前进度**：0%
- **本次推进预期**：thin slice 完整跑通，9节点可视化流水线可观测

## 背景

Line 07 目标：把用户上传的源视频用 AI 翻拍为爆款风格新视频。本 sprint 建立 9节点可视化流水线：Dashboard 展示 n8n 风格节点图，调用真实 AI（ToAPI gpt-image-2 重绘帧 + Aliyun DashScope happy-horse i2v 图生视频），节点07人工选起始帧，CI 自动通过。

## Golden Path（核心场景）

用户从 **Dashboard `/video-remake` 页面** → 上传本地 MP4 → 9节点依序执行 → 每节点可展开查看实际 I/O → 节点07人工（CI 自动）选起始帧 → 下载翻拍 MP4

具体步骤：

1. **[N01 上传解析]** 用户点"选择文件"上传本地 MP4；Dashboard 显示文件名/时长/分辨率；N01 节点变绿
2. **[N02 抽帧]** 系统均匀抽取关键帧序列；节点展开可见帧缩略图列表
3. **[N03 场景分析]** AI 分析帧内容，为每帧生成重绘 Prompt；节点展开可见原帧 + Prompt 文本
4. **[N04 gpt-image-2 重绘]** ToAPI gpt-image-2 对关键帧执行图像重绘；节点展开可见原帧 / 重绘帧对比
5. **[N05 帧评选]** 系统按质量评分推荐最优重绘帧；节点展开可见评分列表
6. **[N06 重绘审核]** 预览重绘帧序列，用户可直接 Continue；节点展开可见帧序列
7. **[N07 起始帧选择]** 用户从候选帧选 i2v 起始帧（**CI 环境 `CI=true` 自动选第一帧通过**）；节点展开可见选中帧
8. **[N08 i2v 生成]** Aliyun DashScope happy-horse i2v 生成翻拍视频片段；节点展开可见生成进度 + 预览
9. **[N09 合成导出]** 音频保留 + 视频片段合并，输出翻拍 MP4；节点展开可见输出文件大小/时长；用户点下载

## 边界情况

- 源视频超 100MB：前端拒绝上传，不进入流水线
- N04 单帧 gpt-image-2 调用失败：节点标红，展示错误信息，允许重试
- N08 i2v 超时（>5 分钟）：节点标红，展示超时提示

## 范围限定

**在范围内**：
- 9节点 n8n 风格可视化图（Dashboard 新页面 `/video-remake`）
- ToAPI gpt-image-2 真实调用（单帧重绘）
- Aliyun DashScope happy-horse i2v 真实调用
- N07 人工选帧 UI + CI 自动通过（`CI=true` 跳过选帧）
- 每节点展开 I/O 面板（原始 JSON 或缩略图）

**不在范围内**：
- 批量多视频翻拍
- 音频 AI 替换（thin 阶段只保留原音）
- 多帧并发重绘（thin：顺序逐帧）
- 翻拍效果对比报告

## 假设

- [ASSUMPTION: ToAPI gpt-image-2 API Key 已在环境变量 TOAPI_API_KEY 可用]
- [ASSUMPTION: Aliyun DashScope API Key 已在环境变量 DASHSCOPE_API_KEY 可用]
- [ASSUMPTION: CI 通过 `CI=true` 判断自动跳过 N07 人工选帧，选第一帧]
- [ASSUMPTION: 9节点顺序固定，thin slice 不支持跳过 / 重排节点]

## DoD（≤8条）

1. Dashboard 新页面 `/video-remake` 展示 9节点 n8n 风格流水线图，每节点有状态指示（灰/运行中/绿/红）
2. 上传有效 MP4（≤100MB）后，N01–N06 节点自动依序执行并变绿，每节点展开可见实际 I/O
3. N04 调用 ToAPI gpt-image-2 返回重绘图，节点展开可见原帧 / 重绘帧对比
4. N07 在非 CI 环境展示候选帧选择 UI；在 `CI=true` 时自动选第一帧并通过
5. N08 调用 Aliyun DashScope happy-horse i2v，返回视频片段
6. N09 合成后用户可点击下载翻拍 MP4（ffprobe 验证：有视频流 + 时长 > 0）
7. 任意节点点击展开可见该节点实际 Input / Output（JSON 字段或图片缩略图）
8. smoke test（windows_cloud）：上传 test.mp4 → CI 自动跑完 9节点 → 下载 mp4 → ffprobe 验证非空有视频流

## 预期受影响文件

- `apps/dashboard/src/pages/VideoRemakePipelinePage.tsx`（新增）
- `apps/dashboard/src/components/video-remake/`（新增，节点图 + 节点 I/O 展开组件）
- `apps/api/src/routes/video-remake.ts`（新增）
- `apps/api/src/controllers/video-remake.controller.ts`（新增）
- `apps/api/src/services/video-remake.service.ts`（新增，含 gpt-image-2 + DashScope 调用）
- `.github/workflows/scripts/smoke/video-remake-9node-smoke.sh`（新增 E2E smoke）
- `apps/dashboard/src/App.tsx` 或路由注册文件（添加 `/video-remake` 路由入口）

## journey_type: user_facing
## journey_type_reason: 涉及 Dashboard 新页面，用户直接与9节点可视化流水线图交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI 统一走 GitHub Actions windows-latest runner E2E
## journey_id: line-07-ai-video-remake
## step_id: L07-S1
