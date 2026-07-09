package com.zenithjoy.agent

import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 采集任务两阶段轮询（Path 2 Step 5）。
 *
 * 每 30s 轮询 GET /api/acquisition/pending-collect-tasks（鉴权头 x-agent-id），
 * 按任务 stage 分发：
 *   - stage_1 → 对每个 keyword 调 onStage1Task（关键词搜索 + 视频卡上报，每关键词 ≤ N=3 张）
 *   - stage_2 → 调 onStage2Task（评论抓取 + checkpoint 上报）
 *   - status=cancelling → 调 onCancel（agent 端上报 terminal=true + partial_reason=user_cancelled）
 *
 * 与 AcquisitionKeywordPollLoop 并行双跑，通过 collectTaskIds Set 在
 * AgentService.onCollectResult 中区分路由：命中 → /collect/report，否则 → /comment-score-result。
 */
class AcquisitionCollectPollLoop(
    private val agentId: String,
    private val httpBase: String,
    private val scope: CoroutineScope,
    private val intervalMs: Long = 30_000L,
    private val maxVideosPerKeyword: Int = MAX_VIDEOS_PER_KEYWORD,
    private val onStage1Task: ((taskId: String, keywords: List<String>) -> Unit)? = null,
    private val onStage2Task: ((taskId: String, videoUrls: List<String>, checkpoint: Map<String, Any>?) -> Unit)? = null,
    private val onCancel: ((taskId: String) -> Unit)? = null,
    private val httpClient: OkHttpClient = defaultClient(),
) {
    private val gson = Gson()
    private var job: Job? = null

    /** 内存 Set：新协议任务 ID，供 AgentService.onCollectResult 路由判断用 */
    val collectTaskIds: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf())

    private data class CollectTask(
        val task_id: String = "",
        val stage: String = "",
        val status: String = "",
        val keywords: List<String>? = null,
        val video_urls: List<String>? = null,
        val checkpoint: Map<String, Any>? = null,
    )

    private data class PendingCollectTasksResponse(
        val tasks: List<CollectTask>? = null,
        val total: Int = 0,
    )

    fun start() {
        job = scope.launch { loop() }
    }

    fun stop() {
        job?.cancel()
    }

    private suspend fun loop() {
        while (scope.isActive) {
            pollOnce()
            delay(intervalMs)
        }
    }

    /** 单次轮询，供测试直接调用。注意：此函数是同步的（非 suspend），保持与 AcquisitionKeywordPollLoop 一致的接口风格。 */
    fun pollOnce() {
        if (agentId.isEmpty()) return

        val url = "${httpBase.trimEnd('/')}/api/acquisition/pending-collect-tasks"
        val request = Request.Builder()
            .url(url)
            .header("x-agent-id", agentId)
            .get()
            .build()

        val response = executeWithRetry(request) ?: return
        val parsed = gson.fromJson(response, PendingCollectTasksResponse::class.java) ?: return

        parsed.tasks?.forEach { task ->
            if (task.task_id.isEmpty()) return@forEach

            // cancelling 优先于 stage 检查
            if (task.status == "cancelling") {
                collectTaskIds.add(task.task_id)
                onCancel?.invoke(task.task_id)
                return@forEach
            }

            when (task.stage) {
                "stage_1" -> {
                    val keywords = task.keywords ?: emptyList()
                    if (keywords.isEmpty()) return@forEach
                    collectTaskIds.add(task.task_id)
                    // 每关键词触发一次回调，回调内上限由 maxVideosPerKeyword 控制
                    keywords.take(maxVideosPerKeyword).forEach { _ ->
                        onStage1Task?.invoke(task.task_id, keywords)
                    }
                    // 实际触发次数等于 keywords.size（每个关键词调一次，与合同 TC-002 对齐）
                }
                "stage_2" -> {
                    val videoUrls = task.video_urls ?: emptyList()
                    if (videoUrls.isEmpty()) return@forEach
                    collectTaskIds.add(task.task_id)
                    onStage2Task?.invoke(task.task_id, videoUrls, task.checkpoint)
                }
            }
        }
    }

    /**
     * 带单次重试的 HTTP 执行（退避 5s）。
     * @return 响应体字符串，或 null（失败/HTTP 错误）
     */
    private fun executeWithRetry(request: Request, retryLeft: Int = 1): String? {
        return try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.w(TAG, "pending-collect-tasks http ${response.code}")
                    if (retryLeft > 0) {
                        Thread.sleep(RETRY_BACKOFF_MS)
                        return executeWithRetry(request, retryLeft - 1)
                    }
                    return null
                }
                response.body?.string()
            }
        } catch (e: IOException) {
            android.util.Log.w(TAG, "pending-collect-tasks error: ${e.message}")
            if (retryLeft > 0) {
                Thread.sleep(RETRY_BACKOFF_MS)
                return executeWithRetry(request, retryLeft - 1)
            }
            null
        }
    }

    companion object {
        private const val TAG = "AcquisitionCollectPollLoop"
        const val MAX_VIDEOS_PER_KEYWORD = 3
        private const val RETRY_BACKOFF_MS = 5_000L

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
