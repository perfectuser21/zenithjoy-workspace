# AI 视频本地流水线 — 设计文档

**日期**：2026-05-16  
**Journey**：Path 1 · Step 5「AI 生成 1 条内容」  
**Thickness**：thin  

---

## 背景

`video-broll-hyperframe` skill 已在 xian-m4 手工验证全链路可行（2026-05-15）。  
`LocalVideoPipelinePage.tsx` 和 `POST /api/ai-video/upload` 已存在，但当前实现是服务器端处理模型。  
本次改造目标：**中台只做 AI API 代理 + job 追踪，客户本地 Agent 负责 FFmpeg + hyperframes 渲染**。

---

## 架构分工

```
Dashboard（浏览器）
  ↓ POST /api/ai-video/upload（video + logo + script）
  ↓ 轮询 GET /api/ai-video/task/:id

中台 API（autopilot.zenjoymedia.media）
  · 创建 job 记录 + 存文件
  · 4 个 AI API 端点（Gemini / Claude / HTML生成 / BGM）
  · job 状态机（pending → processing → completed / failed）

Agent（客户本地 PC）
  · 轮询中台拿 pending jobs
  · 本地 FFmpeg 处理（去气口 + 降噪 + 美颜 + 内容裁剪）
  · 调中台 AI API → 拿 transcript / 场景 JSON / HTML / BGM
  · 本地 hyperframes 渲染
  · 上报完成状态 + 成品路径
```

---

## 数据流（步骤顺序）

```
1. 用户在 Dashboard 上传视频（必填）+ logo（可选）+ 文案（可选）
2. 中台 POST /api/ai-video/upload → 创建 job，存文件到 ~/video-pipeline/jobs/:id/src/
3. 返回 { id, status: "pending" }
4. Dashboard 开始 3s 轮询 GET /api/ai-video/task/:id

5. Agent 轮询 GET /api/ai-video/jobs?status=pending，发现新 job
6. Agent 下载源视频到本地临时目录
7. Agent 本地 FFmpeg Step 1：提取音频（WAV 16kHz mono）
8. Agent 本地 FFmpeg Step 2：去气口 + 内容裁剪（silencedetect + trim/concat）
9. Agent 本地 FFmpeg Step 3：降噪 + 美颜（eq + anlmdn + unsharp）
10. Agent → POST /api/ai-video/jobs/:id/transcribe（发音频文件）
    → 中台调 Gemini 2.0 Flash via OpenRouter → 返回 transcript + 时间戳
11. Agent → POST /api/ai-video/jobs/:id/design（发 transcript + 时长）
    → 中台调 Claude → 返回场景 JSON（scenes[]）
12. Agent → POST /api/ai-video/jobs/:id/compose-html（发 scenes JSON）
    → 中台生成完整 HyperFrame index.html → 返回 HTML 字符串
13. Agent → POST /api/ai-video/jobs/:id/bgm（发风格描述）
    → 中台调 PiAPI ACEStep → 返回 BGM MP3 URL
14. Agent 本地 hyperframes render → output-final.mp4
15. Agent → PUT /api/ai-video/jobs/:id/complete（发成品本地路径）
    → 中台更新 job status = completed，video_url = 本地路径

16. Dashboard 轮询拿到 status=completed → 显示下载入口
```

---

## 中台新增端点（4 个 AI API）

### POST /api/ai-video/jobs/:id/transcribe

```
请求体：multipart/form-data
  audio: File（WAV 或 MP3，≤ 50MB）

响应：
{
  transcript: "...",        // 完整转写文本
  segments: [               // 每句话的时间戳
    { start: 0.6, end: 7.3, text: "..." },
    ...
  ]
}
```

中台行为：调 OpenRouter `google/gemini-2.0-flash-001`，返回带时间戳的转写结果。

### POST /api/ai-video/jobs/:id/design

```
请求体：application/json
{
  transcript: "...",
  segments: [...],
  duration: 26.5,
  topic: "AI训练师证书"     // 可选，用户填写的文案/标题
}

响应：
{
  scenes: [
    {
      start: 0.0,
      duration: 6.0,
      layout: "burst",
      eyebrow: "人社部官方认证",
      title: "AI训练师证书\n亲测有效",
      body: "...",
      tags: ["低难度", "高认可", "职场必备"]
    },
    ...
  ]
}
```

中台行为：调 Claude（claude-sonnet-4-6），按 skill 中的场景设计规则生成分镜。

### POST /api/ai-video/jobs/:id/compose-html

```
请求体：application/json
{
  scenes: [...],
  duration: 26.5,
  video_filename: "video.mp4",   // 相对路径，hyperframes 会用
  logo_filename: "logo.png"      // 可选
}

响应：
{
  html: "<!DOCTYPE html>..."     // 完整 HyperFrame index.html
}
```

中台行为：按照 skill 规范（色彩系统 / 布局 / 动画常量）生成 HTML 字符串，不写磁盘。

### POST /api/ai-video/jobs/:id/bgm

```
请求体：application/json
{
  style: "professional corporate tech, upbeat, piano electronic, no vocals"
}

响应：
{
  url: "https://img.theapi.app/temp/xxx.mp3"
}
```

中台行为：调 PiAPI `Qubico/ace-step` txt2audio，轮询直到完成，返回 MP3 URL。

---

## 中台修改点

### DB：ai_video_pipeline_jobs 表（新建）

```sql
CREATE TABLE zenithjoy.ai_video_pipeline_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending/processing/completed/failed
  progress    INT  NOT NULL DEFAULT 0,
  src_video   TEXT,   -- 服务器上的源视频路径
  src_logo    TEXT,   -- 服务器上的 logo 路径
  topic       TEXT,   -- 用户填的文案/标题
  result_url  TEXT,   -- 成品视频路径（Agent 本地路径或 URL）
  error_msg   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

> 注：与现有 `ai_video_generations` 表并存，不改旧表。

### 路由修改

`apps/api/src/routes/ai-video.ts` 新增：
```
POST   /jobs/:id/transcribe
POST   /jobs/:id/design
POST   /jobs/:id/compose-html
POST   /jobs/:id/bgm
PUT    /jobs/:id/complete
GET    /jobs          （Agent 用，?status=pending）
```

现有路由保持不变（CRUD for ai_video_generations）。

---

## Agent 修改点

Agent 现有代码位置：待确认（本 spec 不规定 Agent 内部实现）。

Agent 需新增能力：
1. 视频 pipeline worker：轮询中台 `/api/ai-video/jobs?status=pending`
2. 本地 FFmpeg 执行器（按 skill Step 1/2/5 的命令）
3. 中台 AI API 调用客户端（4 个端点）
4. 本地 hyperframes 渲染（调用 `hyperframes/dist/cli.js render`）

---

## Dashboard 修改点

`LocalVideoPipelinePage.tsx` 改动极小：
- `uploadVideo()` 改调 `POST /api/ai-video/jobs`（新端点，返回 `{ id, status }`）
- `pollStatus()` 改调 `GET /api/ai-video/jobs/:id`
- `downloadUrl()` 改成 Agent 本地路径（或中台代理下载）
- 描述文案更新：从"自动剪掉静音段"改为"AI 全自动精剪 + 字幕叠加"

---

## 测试策略

| 层级 | 覆盖范围 | 文件位置 |
|------|---------|---------|
| Unit | transcribe/design/compose-html/bgm 每个 service 函数 | `apps/api/src/services/__tests__/ai-video-pipeline.service.test.ts` |
| Integration | 中台 → Gemini/Claude/PiAPI 调用链（用 test key） | `apps/api/src/__tests__/ai-video-pipeline.integration.test.ts` |
| E2E smoke | upload → Agent 处理 → completed 状态可查 | `.github/workflows/scripts/smoke/ai-video-pipeline-smoke.sh` |

---

## Thin 边界（不做）

- 并发 job 处理
- 用户自定义 FFmpeg 参数
- 成品云端存储（Agent 本地路径即最终产物）
- 错误重试
- BGM 音效选择界面
- Dashboard 实时进度步骤显示（只显示整体 %）
