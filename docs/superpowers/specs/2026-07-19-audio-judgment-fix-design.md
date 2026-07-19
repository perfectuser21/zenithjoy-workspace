# 音频转写判定三缺口修复 — 设计

## 背景

2026-07-19 真机端到端测试暴露：Path2 Seg2（内容判定）对 `video` 类型链接走音频转写判定路径时，`judgment_status` 恒为 `pending`，服务端 `/judge-video` 从未被真正调用到。深挖后确认三处独立缺口叠加：

1. `RECORD_AUDIO` 运行时权限从未声明/申请 → `AudioRecord.Builder().build()` 在真机上抛 `SecurityException`，被 catch 吞掉返回 null，链路静默卡死。
2. 客户端把裸 PCM 字节直接 base64 编码，服务端却把它按 `format: 'wav'` 发给 Gemini（OpenAI 兼容 `input_audio.format` 只认字面值，裸 PCM 配 wav 声明会让 Gemini 解析失败/乱猜）。
3. 2026-07-17 用户拍板的"转写文案+title判定"（判定点 `1d078987`，decision `f3dbc2ce`）只完成了客户端路由分流（`captureTypeForVideoUrl`），title 信号从 Stage1 采集开始就从未被捕获，也从未在 Stage2 判定时回传给服务端；`buildPrompt()` 对 audio 分支仍是"甩音频给 Gemini 一步判断"，没有"先转写、再结合 title"这一步。

本次 brainstorming 通过 Explore 调查澄清了缺口 3 的**实际范围**，比 PrepPRD 最初估计更大——附加勘查发现：

- `acquisition_collect_videos.title` 列**已存在**（2026-07-02 建表时就有），`report-videos`/`report` 两个上报端点也**已经**支持写入 `title`——不需要新 migration，也不需要改这两个 INSERT。
- 真正缺失的是两段：① Stage1 采集时 `DouyinCollectService` 从未把 title 填进 `VideoCardInfo`（表里的 title 列因此永远是 null）；② Stage2 判定时 `pending-collect-tasks` 端点只回传 `video_urls`（纯 URL 字符串），Android 拿到的 videoId/captureType 都是从 URL 反解出来的，**没有任何字段能把 title 从服务端带回 Android**，即使 Stage1 把 title 存进库了，Stage2 判定时 Android 侧依然拿不到。

所以 title 信号要走完整闭环，需要 5 处改动（见下方“组件与改动点”），而不是 PrepPRD 最初设想的 2 处。

## 架构 / 数据流

```
Stage1 采集（DouyinCollectService.collectVideoCards）
  → classifyCardAtIndex(index) 已读过 card 的文本节点（collectNodeTexts）
  → 【新增】取最长文本作为 best-effort title，连同 shareUrl 一起塞进 VideoCardInfo
  → reportVideoCards → POST /collect/report-videos { videos: [{video_id/share_url, title, ...}] }
  → 服务端 INSERT ... title = v.title（已存在，无需改）
  → acquisition_collect_videos.title 落库

Stage2 判定（AcquisitionCollectPollLoop.pollOnce → stage_2 分支）
  → GET /pending-collect-tasks
  → 【新增】服务端 SELECT 时把 title 一并查出，响应体新增 video_titles: Record<videoId, title>
  → Android 解析 video_titles，按 videoId 取到 title
  → contentJudgmentService.judge(videoId, captureType, dataB64, title)  【新增 title 形参】
  → ContentJudgmentService 内部：
      - captureType=audio → AudioRecordService.captureAudioSnippet()
        【修复】裸 PCM 前置 44 字节 WAV/RIFF header
      - 【新增】RECORD_AUDIO 运行时权限检查（MainActivity 仿 MediaProjection 模式）
  → buildPayload() 塞入 title 字段 → POST /judge-video { video_id, capture_type, data_b64, title }

服务端 /judge-video
  → judgeVideo(pool, tenantId, videoId, captureType, dataB64, title, ...)  【新增 title 形参】
  → callGemini(...) → buildPrompt(targetProfileDesc, captureType, title)
      audio 分支 prompt："先转写这段音频内容，再结合视频标题《{title}》和转写文案共同判断"
      （单次多模态调用内完成转写+判定，不新增独立转写API，YAGNI）
```

## 组件与改动点

### 1. RECORD_AUDIO 权限（解除真机静默卡死，最高优先级）

- `services/agent-android/app/src/main/AndroidManifest.xml`：新增 `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
- `MainActivity.kt`：仿照现有 `requestMediaProjectionThenStart()` / `mediaProjectionLauncher` 模式（第 36-49、203-211 行），新增一个 `ActivityResultContracts.RequestPermission()` launcher，在触发音频判定前检查 `ContextCompat.checkSelfPermission(RECORD_AUDIO)`，未授予则申请。授予流程与截屏授权并列展示，拒绝时 Toast 提示"录音授权被拒绝，音频判定功能将持续 pending"（与现有 MediaProjection 拒绝提示文案对称）。

### 2. WAV header 封装（修正格式声明与实际编码不符）

- `AudioRecordService.kt` 的 `captureAudioSnippet()`：在 `outputStream.toByteArray()` 之后、`Base64.encodeToString` 之前，前置标准 44 字节 WAV/RIFF header（`SAMPLE_RATE=16000` / 单声道 / 16bit，与录制参数完全一致），使返回的字节流是合法 WAV 文件，匹配服务端 `format: 'wav'` 声明。

### 3. Title 信号全链路打通

**3a. Stage1 采集端（`DouyinCollectService.kt`）**

`collectVideoCards()`（第 573-613 行）里，`classifyCardAtIndex(index)` 已经拿到过 `card` 并调用过 `collectNodeTexts(card)`。新增：在同一个 `card` 上取一次 `collectNodeTexts(card)`，用**最长的一条文本**作为 best-effort title（抖音卡片文案 TextView 通常是子树里最长文本；启发式取法，不保真但优于完全没有），构造 `VideoCardInfo(videoId = "", keyword = ..., title = extractedTitle, shareUrl = shareUrl)` 时带上。

**3b. Stage1→DB（无需改动）**：`report-videos` 的 INSERT 已支持 `title` 列，一旦 `VideoCardInfo.title` 非 null，会自动落库。

**3c. Stage2 判定端 — 服务端 `pending-collect-tasks`**（`apps/api/src/routes/acquisition.ts` 第 287-349 行）

- 第 287-294 行的 SQL 加 `title` 到 SELECT 列表
- 构造响应时（第 335-349 行）新增字段 `video_titles: Record<string, string>`（videoId → title，title 为 null 时不放入该 map，Android 侧取不到就当无 title 处理），与现有 `video_urls` 并列返回。选择新增字段而非改造 `video_urls` 结构，是为了不破坏现有 Android 客户端对 `video_urls: string[]` 的既有解析（向后兼容旧版本 agent）。

**3d. Android 侧解析 + 传递（`AcquisitionCollectPollLoop.kt`）**

- `CollectTask` data class（第 59-66 行）新增 `val video_titles: Map<String, String>? = null`
- `pollOnce()` 的 stage_2 分支（第 136-150 行）：从 `videoId` 查 `task.video_titles?.get(videoId)`，作为新实参传给 `contentJudgmentService.judge(videoId, captureType, dataB64, title = ...)`

**3e. `ContentJudgmentService.kt`**

- `judge()` 签名（第 64-70 行）新增 `title: String? = null`
- `buildPayload()`（第 142-159 行）新增 `title` 形参，非 null 时 `put("title", title)`

**3f. 服务端 `judge-video` 路由 + `content-judgment.ts`**

- `apps/api/src/routes/acquisition.ts` 第 1143-1189 行：解构 `title` from `req.body`，传给 `judgeVideo(...)`
- `content-judgment.ts`：`judgeVideo()`（第 47-55 行）、`callGemini()`（第 116-123 行）、`buildPrompt()`（第 175-176 行）依次新增 `title?: string` 形参并透传
- `buildPrompt()` 的 audio 分支 prompt 文案改为："这是一段视频的开头20秒音频。视频标题是《{title}》。请先在心里转写这段音频的内容，再结合标题和转写内容共同判断是否匹配目标客户画像。"（title 为空时退化为当前无 title 版文案，不强行拼接空标题）

## 判定点（沿用 2026-07-17 已拍板，非本次新增）

- Title 提取用"卡片子树最长文本"启发式——本次沿用 PrepPRD 已定策略，不改。误判后果：偶尔把非标题文本（如点赞数文案）误当标题传给 Gemini，属于判定辅助信号，不是唯一依据，误判后果轻微（decision 已在 PrepPRD 登记，不重复登记）。

## 测试策略

**Unit（Kotlin JVM，`services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/`）：**
- `AudioRecordServiceWavHeaderTest`：验证 `captureAudioSnippet()`（重构为可注入 PCM 数据的形式，或直接测试新抽出的 `wrapPcmAsWav()` 纯函数）返回的字节流前 4 字节为 `"RIFF"`、采样率/位深字段与常量一致
- `ManifestForegroundServiceTypeTest` 同风格新增用例，或新建 `ManifestRecordAudioPermissionTest`：断言 manifest 文本 `contains("android.permission.RECORD_AUDIO")`
- `DouyinCollectServiceTitleCaptureTest`：验证 `VideoCardInfo` 构造时 title 被赋值为 card 节点文本中最长的一条（fake `AccessibilityNodeInfo` 树注入）
- `AcquisitionCollectPollLoop` 现有测试（`AudioJudgmentTest.kt`）扩展：`video_titles` 解析后正确传给 `judge()` 调用（MockWebServer 断言 request body 含 `title` 字段）

**Integration（apps/api，真连 `zenithjoy_test`）：**
- `content-judgment.test.ts` 新增用例：audio 分支 `buildPrompt` 输出包含 title 占位符替换后的文本；`judgeVideo()` 传入 title 时透传到 Gemini 请求体的 prompt 文本里
- `pending-collect-tasks` 相关集成测试新增：`acquisition_collect_videos.title` 非空时，响应体 `video_titles` map 含对应 videoId→title

**Trivial（不需要专门测试，靠现有覆盖）：**
- `judge-video` 路由的参数解构新增 title 字段——现有路由测试已覆盖其余字段解构模式，新增字段走相同模式，不需要专门 case

**E2E：**
- 真机段（RECORD_AUDIO 权限缺失导致的静默卡死）CI 测不到，已在真机上亲眼见证过一次"权限没声明→静默卡死"，proven-to-fire 已达成。修复后下次真机 session 验证 `/judge-video` 真的被调用到、`judgment_status` 不再恒为 pending。
- `golden-path-2-smoke.sh` 暂不新增等价断言（音频转写判定属于真机专属接缝，Path2 smoke 目前的 Step22 已覆盖 dispatch 链路验证，audio judgment 内容正确性不适合用 smoke 脚本断言，会引入对 Gemini 输出的强假设——留给下次真机验证覆盖，PrepPRD 已注明此限制）。

## 不包含（本次范围外）

- 不改造 `video_urls` 现有结构（保持向后兼容，新增并列字段而非替换）
- 不引入独立的音频转写 API 调用（复用 Gemini 单次多模态调用内的"先转写再判断"prompt 指令，避免过度设计成两阶段架构）
- 不处理 `pending-collect-tasks` 响应体里已知存在但本次无关的 `checkpoint` 字段未回填问题（题外发现，另开 issue）
