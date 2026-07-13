package com.zenithjoy.agent

import java.util.concurrent.atomic.AtomicBoolean

/**
 * ScreenCaptureService — 屏幕截图辅助类（非 Android Service）
 *
 * 通过可注入 captureImpl lambda 实现 JVM 可测试性：
 * - 生产环境：captureImpl 由 [ScreenCaptureReal.buildCaptureImpl] 构造，持有真实
 *   MediaProjection + VirtualDisplay + ImageReader 截图逻辑
 * - 测试环境：注入 fake lambda，完全不依赖 Android SDK
 *
 * 真实 MediaProjection 接入（本刀已完成）：MainActivity 一次性弹系统截屏授权框，
 * 结果缓存进 [MediaProjectionHolder]，AgentService 启动时用它换出真实
 * MediaProjection 实例并构造真实 captureImpl（见 AgentService.onCreate）。
 *
 * 单飞锁：同一时刻只允许一次截图在途，VirtualDisplay/ImageReader 是重量级系统资源，
 * 并发调用会互相踩踏（甚至崩溃）。第二次并发调用直接返回 null（视为本轮截图失败，
 * 上层 ContentJudgmentService 会标 pending/skipped_capture_failed，不阻塞后续任务）。
 */
class ScreenCaptureService(
    private val captureImpl: () -> String? = { null },
) {
    private val inFlight = AtomicBoolean(false)

    /**
     * 截取当前屏幕并返回 base64 编码的 JPEG 数据。
     * @return base64 字符串，或 null（截图失败/未授权/未实现/已有一次截图在途）
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
        private const val TAG = "ScreenCaptureService"

        /**
         * 判断截图像素样本是否为"全黑/全零/单一纯色"（DRM/SECURE flag 静默返回占位帧的
         * 典型特征，也覆盖 MediaProjection 未真正就绪时 ImageReader 拿到的空白帧）。
         *
         * 纯函数，便于 JVM 单测；生产环境调用方从 Bitmap 采样若干像素后传入。
         *
         * @param samplePixels 采样像素（ARGB int），空数组视为无效（防御式）
         */
        fun isBlankImage(samplePixels: IntArray): Boolean {
            if (samplePixels.isEmpty()) return true
            val first = samplePixels[0]
            return samplePixels.all { it == first }
        }
    }
}
