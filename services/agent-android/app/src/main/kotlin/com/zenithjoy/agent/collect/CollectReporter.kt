package com.zenithjoy.agent.collect

import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class CollectReporter(
    private val httpBase: String,
    private val agentId: String,
    private val httpClient: OkHttpClient = defaultClient(),
    private val gson: Gson = Gson(),
    private val sleepFn: (Long) -> Unit = { Thread.sleep(it) },
) {
    data class VideoInfo(
        val video_id: String,
        val keyword: String? = null,
        val title: String? = null,
    )

    data class ReportResult(val success: Boolean, val code: String?)

    // POST /collect/report-videos，x-agent-id 必填，重试：网络错误 1次，409/403 放弃
    fun reportVideos(
        taskId: String,
        videos: List<VideoInfo>,
        searchResultEmpty: Boolean = false,
        errorCode: String? = null,
    ): ReportResult {
        val body = buildVideosBody(taskId, videos, searchResultEmpty, errorCode)
        return postWithRetry(
            path = "/api/acquisition/collect/report-videos",
            body = body,
        )
    }

    // POST /collect/report，x-agent-id 必填，重试：网络错误 1次，409/403 放弃
    fun reportCollect(
        taskId: String,
        videoId: String,
        commenters: List<Map<String, Any?>>,
        terminal: Boolean = false,
        partialReason: String? = null,
        checkpoint: Map<String, Any?>? = null,
    ): ReportResult {
        val bodyMap = buildMap<String, Any?> {
            put("task_id", taskId)
            put("video_id", videoId)
            put("commenters", commenters)
            put("terminal", terminal)
            put("checkpoint", checkpoint)
            if (!partialReason.isNullOrEmpty()) put("partial_reason", partialReason)
        }
        return postWithRetry("/api/acquisition/collect/report", gson.toJson(bodyMap))
    }

    fun reportCancel(taskId: String): ReportResult {
        val bodyMap = mapOf(
            "task_id" to taskId,
            "video_id" to "cancelled_${taskId.take(8)}",
            "commenters" to emptyList<Any>(),
            "checkpoint" to mapOf("last_video_id" to null, "processed_video_ids" to emptyList<String>()),
            "terminal" to true,
            "partial_reason" to "user_cancelled",
        )
        return postWithRetry("/api/acquisition/collect/report", gson.toJson(bodyMap))
    }

    private fun buildVideosBody(
        taskId: String,
        videos: List<VideoInfo>,
        searchResultEmpty: Boolean,
        errorCode: String?,
    ): String {
        val videosJson = videos.map { v ->
            buildMap<String, Any?> {
                put("video_id", v.video_id)
                v.keyword?.let { put("keyword", it) }
                v.title?.let { put("title", it) }
            }
        }
        val bodyMap = buildMap<String, Any?> {
            put("task_id", taskId)
            put("videos", videosJson)
            if (searchResultEmpty || errorCode != null) {
                val reason = buildMap<String, Any?> {
                    if (searchResultEmpty) put("search_result", "empty")
                    errorCode?.let { put("error_code", it) }
                }
                put("reason", reason)
            }
        }
        return gson.toJson(bodyMap)
    }

    private fun postWithRetry(path: String, body: String, retryLeft: Int = 1): ReportResult {
        return try {
            val resp = doPost(path, body)
            val code = resp.code
            resp.close()
            if (code == 409 || code == 403) {
                ReportResult(false, "HTTP_$code")
            } else if (code !in 200..299 && retryLeft > 0) {
                sleepFn(5_000L)
                postWithRetry(path, body, retryLeft - 1)
            } else {
                ReportResult(code in 200..299, if (code in 200..299) null else "HTTP_$code")
            }
        } catch (e: Exception) {
            if (retryLeft > 0) {
                sleepFn(5_000L)
                postWithRetry(path, body, retryLeft - 1)
            } else {
                ReportResult(false, "NETWORK_ERROR")
            }
        }
    }

    private fun doPost(path: String, body: String): okhttp3.Response {
        val url = "${httpBase.trimEnd('/')}$path"
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .header("x-agent-id", agentId)
            .build()
        return httpClient.newCall(request).execute()
    }

    companion object {
        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
