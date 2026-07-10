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
 *   - stage_1 → 对每个 keyword 独立调 onStage1Task（单个关键词，关键词搜索后调 /collect/report-videos）
 *   - stage_2 → 调 onStage2Task（评论抓取 + 每视频 /collect/report 上报，逐视频串行）
 *   - status=cancelling → 调 onCancel（agent 端上报 terminal=true + partial_reason=user_cancelled）
 *
 * 路由集合：
 *   - stage1TaskIds：Stage1 任务 ID，AgentService 据此走 /collect/report-videos
 *   - collectTaskIds：全部两阶段任务 ID（含 Stage1+Stage2），旧协议 /comment-score-result 判断用
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

    /** 全部两阶段任务 ID（Stage1+Stage2），用于旧协议路由判断 */
    val collectTaskIds: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf())

    /** Stage1 任务 ID，AgentService.onCollectResult 据此走 POST /collect/report-videos */
    val stage1TaskIds: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf())

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
        // 首次 poll 同步执行（不等协程调度），保证 start() 返回时第一轮回调已触发，
        // 与 AcquisitionKeywordPollLoop 在真实 TestScope 下的确定性行为对齐；
        // GlobalScope 场景下（生产用）不依赖协程调度器真跑一轮才能验证副作用。
        pollOnce()
        job = scope.launch { loop() }
    }

    fun stop() {
        job?.cancel()
    }

    private suspend fun loop() {
        while (scope.isActive) {
            delay(intervalMs)
            pollOnce()
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

        val response = executeOnce(request) ?: return
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
                    stage1TaskIds.add(task.task_id)
                    // 每关键词独立触发一次回调（单个 keyword），回调次数 = keywords.size，
                    // 与合同 TC-002 对齐；每次传单元素列表便于 AgentService 逐词分发
                    keywords.take(maxVideosPerKeyword).forEach { keyword ->
                        onStage1Task?.invoke(task.task_id, listOf(keyword))
                    }
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
     * 单次 HTTP 执行，不重试（与 AcquisitionKeywordPollLoop.pollOnce() 一致：
     * 失败/非 2xx 只记日志返回 null，下一轮 30s 轮询自然重试，不在单次 poll 内阻塞重试）。
     * @return 响应体字符串，或 null（失败/HTTP 错误）
     */
    private fun executeOnce(request: Request): String? {
        return try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    logW("pending-collect-tasks http ${response.code}")
                    return null
                }
                response.body?.string()
            }
        } catch (e: IOException) {
            logW("pending-collect-tasks error: ${e.message}")
            null
        }
    }

    /** android.util.Log 在纯 JVM 单元测试下未 mock 会抛 RuntimeException，这里吞掉保证 pollOnce() 不因日志而崩。 */
    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
        }
    }

    companion object {
        private const val TAG = "AcquisitionCollectPollLoop"
        const val MAX_VIDEOS_PER_KEYWORD = 3

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
