package com.zenithjoy.agent

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * ContentJudgmentService — 视频内容判决服务（commit-3 Green skeleton）
 *
 * 职责：
 *   1. 接收截图（base64 JPEG）或录音片段（base64 PCM）
 *   2. POST 到中台 /api/acquisition/judge-video
 *   3. 返回判决结果（matched / rejected / pending）
 *   4. 8s 超时 → 本地标 pending，不阻塞后续视频处理
 *
 * Spike 结论：MediaProjection 一次性授权方案（见 spike-media-projection.md）
 *
 * 设计：纯函数风格，无 Activity 依赖，便于单元测试注入 mock httpClient。
 */
class ContentJudgmentService(
    private val agentId: () -> String,
    private val httpBase: String,
    private val tenantId: () -> String,
    private val httpClient: OkHttpClient = defaultClient(),
    private val screenCaptureService: ScreenCaptureService? = null,
) {
    companion object {
        private const val TAG = "ContentJudgmentService"
        private const val JUDGE_TIMEOUT_MS = 8_000L

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(JUDGE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    data class JudgmentResult(
        val judgmentStatus: String,  // "matched" | "rejected" | "pending"
        val judgmentReason: String?,
        val cacheHit: Boolean = false,
    )

    /**
     * 判决单个视频内容是否匹配目标画像。
     *
     * @param videoId     抖音视频 ID
     * @param captureType 截图类型：screenshot | audio | skipped_capture_failed
     * @param dataB64     base64 编码的截图或录音数据
     * @param forceResult 仅测试环境：强制返回指定结果（matched/rejected/pending）
     * @param forceTimeout 仅测试环境：强制模拟超时（返回 pending）
     * @return JudgmentResult，超时或网络错误时返回 judgment_status=pending
     */
    fun judge(
        videoId: String,
        captureType: String = "screenshot",
        dataB64: String,
        forceResult: String? = null,
        forceTimeout: Boolean = false,
    ): JudgmentResult {
        val currentTenantId = tenantId()
        if (currentTenantId.isEmpty()) {
            logW("tenantId 为空，跳过判决 videoId=$videoId")
            return JudgmentResult(judgmentStatus = "pending", judgmentReason = "no_tenant")
        }

        // FR-C: dataB64 为空时，尝试通过 screenCaptureService 截图
        val actualDataB64: String
        val actualCaptureType: String
        if (dataB64.isEmpty() && screenCaptureService != null) {
            val captured = screenCaptureService.captureToBase64()
            if (captured == null) {
                // 截图失败不再本地短路返回（旧行为：直接 return pending 且从不 POST，
                // 导致服务端 judgment_reason 永远为空、DB 里 pending 空转查无原因）。
                // 改为：带 capture_type=skipped_capture_failed 继续回报，让服务端把原因落到
                // acquisition_collect_videos.judgment_reason —— 环境守卫：DB 一眼可辨截图失败。
                logW("截图失败，改以 skipped_capture_failed 回报 videoId=$videoId")
                actualDataB64 = ""
                actualCaptureType = "skipped_capture_failed"
            } else {
                actualDataB64 = captured
                actualCaptureType = captureType
            }
        } else {
            actualDataB64 = dataB64
            actualCaptureType = captureType
        }

        val payload = buildPayload(
            tenantId = currentTenantId,
            videoId = videoId,
            captureType = actualCaptureType,
            dataB64 = actualDataB64,
            forceResult = forceResult,
            forceTimeout = forceTimeout,
        )

        val url = "${httpBase.trimEnd('/')}/api/acquisition/judge-video"
        val requestBody = payload.toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(url)
            .header("x-agent-id", agentId())
            .header("X-Tenant-Id", currentTenantId)
            .post(requestBody)
            .build()

        return try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    logW("judge-video http ${response.code} videoId=$videoId")
                    return JudgmentResult(judgmentStatus = "pending", judgmentReason = "http_error_${response.code}")
                }
                val body = response.body?.string() ?: return JudgmentResult(
                    judgmentStatus = "pending",
                    judgmentReason = "empty_response"
                )
                parseResponse(body)
            }
        } catch (e: IOException) {
            // 超时（SocketTimeoutException 是 IOException 子类）或网络错误 → pending
            logW("judge-video timeout/error videoId=$videoId: ${e.message}")
            JudgmentResult(judgmentStatus = "pending", judgmentReason = "timeout_or_network_error")
        }
    }

    private fun buildPayload(
        tenantId: String,
        videoId: String,
        captureType: String,
        dataB64: String,
        forceResult: String?,
        forceTimeout: Boolean,
    ): String {
        val obj = JSONObject().apply {
            put("tenant_id", tenantId)
            put("video_id", videoId)
            put("capture_type", captureType)
            put("data_b64", dataB64)
            if (forceResult != null) put("force_result", forceResult)
            if (forceTimeout) put("force_timeout", true)
        }
        return obj.toString()
    }

    private fun parseResponse(body: String): JudgmentResult {
        return try {
            val json = JSONObject(body)
            val status = json.optString("judgment_status", "pending")
            val reason = if (json.has("judgment_reason")) json.optString("judgment_reason") else null
            val cacheHit = json.optBoolean("cache_hit", false)
            JudgmentResult(
                judgmentStatus = status,
                judgmentReason = reason,
                cacheHit = cacheHit,
            )
        } catch (e: Exception) {
            logW("parseResponse failed: ${e.message}")
            JudgmentResult(judgmentStatus = "pending", judgmentReason = "parse_error")
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
            // JVM 单元测试环境下 android.util.Log 未 mock，吞掉
        }
    }
}
