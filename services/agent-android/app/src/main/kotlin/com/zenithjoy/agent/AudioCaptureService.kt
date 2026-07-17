package com.zenithjoy.agent

import java.util.concurrent.atomic.AtomicBoolean

/**
 * AudioCaptureService — 音频采集辅助类（非 Android Service）
 *
 * 镜像 [ScreenCaptureService] 的注入式设计：通过可注入 captureImpl lambda 实现 JVM
 * 可测试性——生产环境由 [AudioRecordService.captureAudioSnippet] 提供真实实现（持有
 * MediaProjection + AudioPlaybackCaptureConfiguration 系统音频采集逻辑），测试环境注入
 * fake lambda，完全不依赖 Android SDK。
 *
 * 单飞锁：同一时刻只允许一次录音在途，AudioRecord 是重量级系统资源，并发调用会互相
 * 踩踏。第二次并发调用直接返回 null（视为本轮采集失败，上层 ContentJudgmentService
 * 会标 pending/skipped_capture_failed，不阻塞后续任务）。
 */
class AudioCaptureService(
    private val captureImpl: () -> String? = { null },
) {
    private val inFlight = AtomicBoolean(false)

    /**
     * 采集当前系统音频（视频播放声）并返回 base64 编码的 PCM 数据。
     * @return base64 字符串，或 null（采集失败/未授权/未实现/已有一次采集在途）
     */
    fun captureToBase64(): String? {
        if (!inFlight.compareAndSet(false, true)) {
            logW("capture already in-flight — skip concurrent request")
            return null
        }
        return try {
            captureImpl()
        } catch (e: Exception) {
            logW("captureImpl threw: ${e.message}")
            null
        } finally {
            inFlight.set(false)
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
            // JVM 单元测试环境下 android.util.Log 未 mock，吞掉
        }
    }

    companion object {
        private const val TAG = "AudioCaptureService"
    }
}
