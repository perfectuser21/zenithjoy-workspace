package com.zenithjoy.agent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * FramePushLoop — 把本机屏幕帧循环推给中台「工作机」控制塔（"上墙"）。
 *
 * 端点：`POST <httpBase>/api/workers/<agentUuid>/frame`，body 是 JPEG 原始字节，
 * 鉴权走 `X-Agent-License: <license_key>`（中台 PR #1748：内部 token 或 agent 自带
 * license 二选一 —— 客户机 agent 拿不到内部编排 token，只有装机时发的 license）。
 *
 * 为什么不复用心跳那条链：心跳 20s 一次、走 JSON、body 里带 license 字段；上墙是
 * ~8fps 的二进制流，共用一个 loop 会互相拖慢，各走各的更简单也更好停（用户关掉
 * "上墙"开关时只停这条，心跳照旧 —— 心跳是客户机上唯一的远程视野，绝不能连坐）。
 *
 * 三条纪律：
 *  1. **能在本地判死的，绝不发出去**：agentUuid 不是 uuid（服务端 requireAgentUuid 只会
 *     400）、license 空、截不到帧、帧超上限（服务端 express.raw 120KB 会 413）——
 *     这几种一律本地短路，8fps 下每一次白跑都是 8 倍浪费。
 *  2. **被拒就退避**：401/403 是凭据/租户问题，重试一万次也是同一个答案，继续按帧率
 *     砸服务端只会把日志刷爆。退避到 [REJECTED_BACKOFF_MS] 等人改配置。
 *  3. **截图单飞由 [ScreenCaptureService] 兜**：内容判定也在抢同一个 VirtualDisplay/
 *     ImageReader（A14 纪律：全进程只能有一个常驻会话），撞上时它返回 null，这里
 *     记 SKIPPED_NO_FRAME 跳过本帧即可，不重试、不报错。
 */
class FramePushLoop(
    private val params: Params,
    private val scope: CoroutineScope,
    /** 取一帧 JPEG 字节；null = 本轮取不到（未授权 / 截图单飞占用 / 黑屏被丢弃）。 */
    private val frameProvider: () -> ByteArray?,
    private val intervalMs: Long = DEFAULT_INTERVAL_MS,
    private val httpClient: OkHttpClient = defaultClient(),
    private val onResult: ((Result) -> Unit)? = null,
) {
    private var job: Job? = null

    /** 推帧所需的最小参数集（纯 data class，无 Android 依赖，方便单测）。 */
    data class Params(
        val httpBase: String,   // https://autopilot.zenjoymedia.media
        val licenseKey: String,
        /** `zenithjoy.agents.id`（UUID）—— 即 AgentConfig.agentUuid，不是文本 agentId。 */
        val agentUuid: String,
    )

    enum class Result {
        /** 服务端已收（2xx）。 */
        PUSHED,
        /** agentUuid 不是 uuid 或 license 为空 —— 还没注册好，等配置到位。 */
        SKIPPED_NOT_CONFIGURED,
        /** 这一轮取不到帧（未授权 / 截图单飞占用 / 黑屏）。 */
        SKIPPED_NO_FRAME,
        /** 帧比服务端上限还大，本地丢掉，别去换一个 413。 */
        SKIPPED_TOO_LARGE,
        /** 401/403 —— 凭据无效或跨租户，重试无用。 */
        REJECTED,
        /** 其它 HTTP 错误或网络异常，下一轮照常重试。 */
        FAILED,
    }

    fun start() {
        job = scope.launch { loop() }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun loop() {
        while (scope.isActive) {
            val result = pushOnce()
            delay(nextDelayMs(result, intervalMs))
        }
    }

    internal fun pushOnce(): Result {
        val result = doPushOnce()
        onResult?.invoke(result)
        return result
    }

    private fun doPushOnce(): Result {
        if (params.licenseKey.isEmpty() || !isPushableAgentUuid(params.agentUuid)) {
            return Result.SKIPPED_NOT_CONFIGURED
        }
        val frame = try {
            frameProvider()
        } catch (e: Exception) {
            logW("frameProvider threw: ${e.message}")
            null
        }
        if (frame == null || frame.isEmpty()) return Result.SKIPPED_NO_FRAME
        if (frame.size > MAX_FRAME_BYTES) {
            logW("frame ${frame.size}B > ${MAX_FRAME_BYTES}B — dropped locally")
            return Result.SKIPPED_TOO_LARGE
        }

        val url = "${params.httpBase.trimEnd('/')}/api/workers/${params.agentUuid}/frame"
        val request = Request.Builder()
            .url(url)
            .header(HEADER_AGENT_LICENSE, params.licenseKey)
            .post(frame.toRequestBody(JPEG_MEDIA_TYPE))
            .build()

        return try {
            httpClient.newCall(request).execute().use { response ->
                when {
                    response.isSuccessful -> Result.PUSHED
                    response.code == 401 || response.code == 403 -> {
                        logW("frame push rejected ${response.code} — license 无效或与该 agent 跨租户，退避")
                        Result.REJECTED
                    }
                    else -> {
                        logW("frame push http ${response.code}")
                        Result.FAILED
                    }
                }
            }
        } catch (e: IOException) {
            logW("frame push error: ${e.message}")
            Result.FAILED
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
            // JVM 单测环境下 android.util.Log 未 mock，吞掉（同 HttpHeartbeatLoop 既有约定）
        }
    }

    companion object {
        private const val TAG = "FramePushLoop"

        const val HEADER_AGENT_LICENSE = "X-Agent-License"

        /** 125ms ≈ 8fps：够看出"屏幕在动"，又不至于把客户流量和电池打爆。 */
        const val DEFAULT_INTERVAL_MS = 125L

        /**
         * 服务端 `express.raw({ limit: '120kb' })`，超了直接 413。本地卡在 118KB，
         * 留 2KB 余量给传输层，宁可丢一帧也不去换一个必然失败的往返。
         */
        const val MAX_FRAME_BYTES = 118 * 1024

        /** 凭据被拒后的退避：等人去改 license / 换机器，不是等网络恢复。 */
        const val REJECTED_BACKOFF_MS = 60_000L

        /** 还没注册好时的退避：等 register/heartbeat 把 agentUuid 收敛出来。 */
        const val NOT_CONFIGURED_BACKOFF_MS = 5_000L

        private val JPEG_MEDIA_TYPE = "image/jpeg".toMediaType()

        private val UUID_PATTERN =
            Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

        /**
         * 服务端 `/api/workers/:agentId/frame` 的 requireAgentUuid 只认 uuid，文本 agentId
         * （如 "xian-rog-agent"）必被 400 —— 与其 8fps 白跑，不如本地先判死。
         */
        fun isPushableAgentUuid(value: String): Boolean = UUID_PATTERN.matches(value)

        /** 下一轮等多久：正常按帧率，被拒/未配置时退避。 */
        fun nextDelayMs(result: Result, intervalMs: Long): Long = when (result) {
            Result.REJECTED -> REJECTED_BACKOFF_MS
            Result.SKIPPED_NOT_CONFIGURED -> NOT_CONFIGURED_BACKOFF_MS
            else -> intervalMs
        }

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

/** AgentConfig → FramePushLoop.Params 的便捷扩展函数（对齐 toHeartbeatParams）。 */
fun AgentConfig.toFramePushParams(): FramePushLoop.Params =
    FramePushLoop.Params(
        httpBase = deriveHttpBase(),
        licenseKey = licenseKey,
        agentUuid = agentUuid,
    )
