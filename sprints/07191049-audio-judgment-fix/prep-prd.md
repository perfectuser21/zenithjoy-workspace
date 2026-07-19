# Bug PrepPRD：音频转写视频判定（2026-07-17决策）三处未完成缺口导致真机判定静默卡死

## 症状
2026-07-19真机端到端测试：真实设备采集到视频后，判定环节（Seg2）完全无响应，
`judgment_status` 恒为 `pending`，服务端 `/judge-video` 接口从未被调用过。设备已授予
MediaProjection截屏权限，问题依旧。

## 根因（三处独立缺口）
1. **RECORD_AUDIO权限缺失**：`AudioPlaybackCaptureConfiguration`+`AudioRecord` 在Android系统层面
   仍要求声明 `RECORD_AUDIO` 权限，本仓库 `AndroidManifest.xml` 从未声明。真机上 `AudioRecord.Builder().build()`
   直接抛 `SecurityException`，被 `AudioRecordService.captureAudioSnippet()` 的 catch 块吞掉记日志后返回
   null，整条链路静默卡死（`AudioRecordService.kt:83-86`）。
2. **音频格式声明与实际编码不符**：客户端把裸PCM字节（无WAV/RIFF头）直接base64编码返回
   （`AudioRecordService.kt:82`），服务端却把它标注成 `format: 'wav'` 发给Gemini
   （`content-judgment.ts:138`）——OpenAI兼容的 `input_audio.format` 字段只接受 'wav'/'mp3'
   字面值，裸PCM数据配'wav'声明会让Gemini解析失败或产出垃圾判断。
3. **"转写文案+title判定"的用户决策(2026-07-17)只完成了客户端路由分流层**（PR#1354/692986fa
   只改了 `AcquisitionCollectPollLoop.captureTypeForVideoUrl` 按URL类型选screenshot/audio），
   服务端 `buildPrompt()` 对audio分支仍是把裸音频甩给Gemini一步判断，没有"先转写"这一步；
   `DouyinCollectService.VideoCardInfo.title` 字段存在但从未被赋值（`DouyinCollectService.kt:592`
   构造时只传 videoId/keyword/shareUrl），`/judge-video` 请求体和 `ContentJudgmentService.buildPayload()`
   都没有title字段——title这个信号从Stage1采集开始就从未被捕获过。

## 修法

### 1. RECORD_AUDIO权限（关键路径，解除卡死）
- `AndroidManifest.xml` 加 `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
- `MainActivity.kt` 仿照现有MediaProjection流程，在触发音频采集前检查
  `ContextCompat.checkSelfPermission(RECORD_AUDIO)`，未授予则 `ActivityCompat.requestPermissions()`
  运行时申请（新增一次性权限框，跟截屏权限框并列）

### 2. 修正音频格式（WAV封装）
- `AudioRecordService.kt` 在 `captureAudioSnippet()` 返回前，给裸PCM字节数组前置44字节标准WAV
  header（采样率16000/单声道/16bit，与录制参数一致），使实际数据真的是合法WAV文件，匹配服务端
  `format: 'wav'` 声明

### 3. 补齐title信号（Stage1采集→judge-video全链路）
- `DouyinCollectService.kt`：在 `captureShareUrlForCard()` 抓取分享链接的同一个卡片节点上，用已有的
  `collectNodeTexts(card)` 取文本列表中最长的一条作为 best-effort title（真实抖音卡片文案文本通常是
  该卡片子树里最长的TextView，最长即title是启发式取法，不保真但优于完全没有），构造 `VideoCardInfo`
  时带上
- 服务端 `acquisition_collect_videos` 表加 `title` 列（新migration），`report-videos`/`collect/report`
  端点接受并落库title
- `/judge-video` 路由、`ContentJudgmentService.buildPayload()`（Android）扩展带title字段
- `content-judgment.ts:buildPrompt()` 对audio分支的prompt改为："先转写这段音频内容，再结合视频标题
  《{title}》和转写文案共同判断"——单次多模态调用内完成转写+判定两步（不新增独立转写API调用，
  Gemini原生支持音频输入+按prompt指示先转写再推理，避免过度设计成两阶段架构）

## Regression Test 计划
- Kotlin JVM单测：`AudioRecordServiceWavHeaderTest`——验证 `captureAudioSnippet()` 返回的字节流带
  合法WAV RIFF header（前4字节"RIFF"，采样率/位深字段正确）
- Kotlin JVM单测：`DouyinCollectServiceTitleCaptureTest`——验证 `VideoCardInfo` 构造时title字段被
  正确赋值为卡片节点文本中最长的一条
- 服务端 vitest：`content-judgment.test.ts` 新增用例——audio分支prompt包含title占位符替换后的文本，
  buildPayload/judge-video请求体含title字段
- 集成测试（真连Postgres）：`acquisition_collect_videos.title` 列存在性+report-videos落title值

## proven-to-fire 守卫
真机段（RECORD_AUDIO权限缺失导致的静默卡死）CI测不到，无法自动proven-to-fire——但今晚已经在真机
上亲眼见证过一次"权限没声明→静默卡死"，属于已经proven-to-fire过的真实故障；修复后需要下次真机
排查时验证`/judge-video`真的被调用到（走golden-path-2-smoke.sh的等价断言或下次真机session验证）。

## 验收标准
- [ ] AndroidManifest.xml含RECORD_AUDIO权限声明
- [ ] AudioRecordService返回的字节流是合法WAV（单测验证RIFF header）
- [ ] VideoCardInfo.title在真实采集流程中被赋值（单测验证non-null when card有文本）
- [ ] /judge-video请求体/buildPrompt含title信号
- [ ] apps/api vitest全绿 + Kotlin JVM单测全绿
- [ ] CI全绿
