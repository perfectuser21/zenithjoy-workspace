package com.zenithjoy.agent

/**
 * ScreenCaptureService — 屏幕截图辅助类（非 Android Service）
 *
 * 通过可注入 captureImpl lambda 实现 JVM 可测试性：
 * - 生产环境：captureImpl 持有真实 MediaProjection 截图逻辑
 * - 测试环境：注入 fake lambda，完全不依赖 Android SDK
 *
 * 真实 MediaProjection 接入：需要 MainActivity 授权后把实例传入此处，
 * 使用 ImageReader + VirtualDisplay 捕获屏幕帧（见 spike-media-projection.md）。
 * 本 sprint 先接通调用链路，MediaProjection 实际授权接入为下一刀。
 */
class ScreenCaptureService(
    private val captureImpl: () -> String? = { null },
) {
    /**
     * 截取当前屏幕并返回 base64 编码的 JPEG 数据。
     * @return base64 字符串，或 null（截图失败/未授权/未实现）
     */
    fun captureToBase64(): String? = captureImpl()
}
