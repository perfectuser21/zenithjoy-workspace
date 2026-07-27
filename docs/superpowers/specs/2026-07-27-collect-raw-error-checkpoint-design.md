# 设计：安卓采集失败原始错误码留证

## 背景

2026-07-27 排查 Path2 安卓智能获客验收 5 号机（华为 BKK-AL10）"采集任务失败"时发现：安卓端 `AgentService.kt` 在上报采集结果前，先用 `CollectFailureClassifier.classify(errorCode)` 把原始错误码（如疑似的 `ALL_SHARE_FAILED`）归类成 5 个人话分类之一（含 UNKNOWN 兜底），再把**分类后的值**覆盖回 `errorCode` 变量发给服务端。服务端 `acquisition_collect_tasks.error_code` 列因此永远只存得到分类结果，原始信号从未离开过手机——事后想诊断"到底是哪种具体故障"时无据可查。

`acquisition_collect_tasks` 表已有一个 `checkpoint JSONB` 列（其它端点如 `/collect/report` 已经在用它存诊断性上下文），但 `/collect/report-videos` 这条路径从没往里写过东西。

## 目标

在**不改变**分类算法（`CollectFailureClassifier.kt`）、**不改变**客户/Dashboard 看到的 `error_code` 展示逻辑的前提下，让服务端多存一份原始错误码，供事后排查。

## 不做的事

- 不新建表、不新建字段（复用已有的 `checkpoint JSONB` 列）
- 不改变 `error_code` 列的值域/分类策略
- 不处理 `/collect/report`（Stage2 评论上报）路径——它已经有 `checkpoint` 参数在用，本次只补 `/collect/report-videos`（Stage1）这一条缺失的路径

## 设计

### 1. 客户端：`CollectReporter.kt`

`reportVideos()` 新增可选参数，与 `reportCollect()` 已有的同名参数保持一致：

```kotlin
fun reportVideos(
    taskId: String,
    videos: List<VideoInfo>,
    searchResultEmpty: Boolean = false,
    errorCode: String? = null,
    checkpoint: Map<String, Any?>? = null,  // 新增
): ReportResult
```

`buildVideosBody()` 内部把 `checkpoint`（非空时）加进请求体 JSON，字段名与 `/collect/report` 保持一致（`checkpoint`），不新增自定义协议。

### 2. 客户端：`AgentService.kt`

调用点（约 865 行）在分类**之前**先把原始值捕获下来，构造 `checkpoint`：

```kotlin
val rawErrorCode = errorCode
val classifiedErrorCode = if (videos.isEmpty()) CollectFailureClassifier.classify(errorCode) else null
reporter?.reportVideos(
    taskId,
    videos,
    errorCode = classifiedErrorCode,
    checkpoint = if (classifiedErrorCode != null) mapOf("raw_error_code" to rawErrorCode) else null,
)
```

`errorCode` 参数（分类后的值）保持完全不变——服务端现有 `error_code` 列写入逻辑、客户展示逻辑零改动。

### 3. 服务端：`apps/api/src/routes/acquisition.ts`

`POST /collect/report-videos` handler：
1. 解构请求体时多读一个 `checkpoint`（`const { task_id: taskId, videos, reason, checkpoint } = req.body || {}`）
2. 失败态那条 `UPDATE zenithjoy.acquisition_collect_tasks` 语句（约 894 行）里，把 `checkpoint` merge 进去，写法与仓库里已有的 `stage2_dispatch_counts`/`media_kinds` merge 模式一致：

```sql
UPDATE zenithjoy.acquisition_collect_tasks
   SET status = $2, error_code = $3,
       checkpoint = COALESCE(checkpoint, '{}'::jsonb) || $4::jsonb,
       started_at = COALESCE(started_at, NOW()), ended_at = NOW(), updated_at = NOW()
 WHERE id = $1
```

- `checkpoint` 缺失或非对象时，merge 参数传 `'{}'::jsonb`（不写入任何内容，行为等同于改动前）
- 只做浅层 `||` merge，不做深度合并——这条路径每次只会写一次 `raw_error_code`，不存在需要深度合并的历史字段冲突

## 边界情况

- `videos` 非空（成功场景）：`classifiedErrorCode` 为 `null`，本次改动不生成 `checkpoint`，行为不变
- 客户端不带 `checkpoint` 字段（旧版 APK 请求）：服务端 `checkpoint` 解构得到 `undefined`，merge 参数退化成 `'{}'::jsonb`，等价于改动前的行为——**向后兼容，不要求同时升级客户端**
- `checkpoint` 里可能已有其它字段（本路径目前没有，但未来若加）：`||` merge 保留已有 key，只新增/覆盖 `raw_error_code`

## 测试策略

- **Kotlin 单测**（`CollectReporterTest.kt` 或同目录新测试）：验证 `reportVideos` 传入 `checkpoint` 时，实际 HTTP body 包含该字段；不传时 body 不含 `checkpoint` 键
- **TS 单测**（`acquisition.test.ts` 或相邻测试文件，mock pool.query）：验证 `/collect/report-videos` 收到 `checkpoint: {raw_error_code: "ALL_SHARE_FAILED"}` 时，UPDATE 语句的 jsonb merge 参数正确；不带 `checkpoint` 时 merge 参数为 `'{}'::jsonb`
- 无需 E2E（纯内部诊断字段，不涉及用户可见行为）
