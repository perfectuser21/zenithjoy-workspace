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
 * 关键词采集任务轮询（对齐桌面 agent services/agent/src/index.ts 的
 * startAcquisitionKeywordLoop）。
 *
 * ws0/ws1 心跳协议（HttpHeartbeatLoop）派发的是通用 publish_tasks 队列，
 * 服务端从未往里写过 platform=android_douyin 的行——那条路径没有真实任务源。
 * 真正的关键词任务来自 GET /api/acquisition/pending-keyword-tasks（按
 * x-agent-license 鉴权，不区分 platform），桌面 agent 已经在用这个端点轮询，
 * 这里让安卓 agent 走同一条路。
 *
 * task_id 就是 acquisition_keyword_tasks.id，全程原样透传给
 * DouyinCollectService.dispatchTask，最终作为 comment-score-result 的
 * keyword_task_id 回传——三端必须用同一个 id，否则服务端反查租户会失败。
 */
class AcquisitionKeywordPollLoop(
    private val params: Params,
    private val scope: CoroutineScope,
    private val intervalMs: Long = 30_000L,
    private val onTask: ((task: KeywordTask) -> Unit)? = null,
    private val httpClient: OkHttpClient = defaultClient(),
) {
    private val gson = Gson()
    private var job: Job? = null

    data class Params(
        val httpBase: String,
        val licenseKey: String,
    )

    data class KeywordTask(
        val task_id: String,
        val keyword: String,
        val keywords: List<String> = emptyList(),
    )

    private data class PendingTasksResponse(
        val tasks: List<KeywordTask>? = null,
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

    internal fun pollOnce() {
        if (params.licenseKey.isEmpty()) return
        val url = "${params.httpBase.trimEnd('/')}/api/acquisition/pending-keyword-tasks"

        val request = Request.Builder()
            .url(url)
            .header("x-agent-license", params.licenseKey)
            .get()
            .build()

        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.w(TAG, "pending-keyword-tasks http ${response.code}")
                    return
                }
                val raw = response.body?.string() ?: return
                val parsed = gson.fromJson(raw, PendingTasksResponse::class.java)
                parsed.tasks?.forEach { task ->
                    if (task.task_id.isNotEmpty() && task.keyword.isNotEmpty()) {
                        onTask?.invoke(task)
                    }
                }
            }
        } catch (e: IOException) {
            android.util.Log.w(TAG, "pending-keyword-tasks error: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "AcquisitionKeywordPollLoop"

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
