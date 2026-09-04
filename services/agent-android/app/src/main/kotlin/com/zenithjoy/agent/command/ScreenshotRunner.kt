package com.zenithjoy.agent.command

import kotlinx.coroutines.delay

/**
 * screenshot 指令。错误码永久/瞬时分类（判定点「screenshot 失败分类」）：
 * NEED_USER_REAUTH / NOT_INITIALIZED 永久（上游停止重试并告警）；CAPTURE_FAILED 瞬时
 * （含撞 8fps 推流单飞锁与 blank 帧，二者现有 ScreenCaptureService API 下不可分，
 * 有意合并，detail 注明）。回执必带双分辨率（判定点「截图↔点击坐标系对齐」）：
 * 截图被 ScreenCaptureReal 压到长边 720px，点击用物理坐标，上游必须换算。
 */
class ScreenshotRunner(
    private val initialized: () -> Boolean,
    private val hasAuthorization: () -> Boolean,
    private val capture: () -> String?,
    private val screenSize: () -> Pair<Int, Int>,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    suspend fun run(): CmdOutcome {
        if (!initialized()) return CmdOutcome(false, CommandProtocol.ERR_NOT_INITIALIZED)
        if (!hasAuthorization()) return CmdOutcome(false, CommandProtocol.ERR_NEED_USER_REAUTH)
        var b64: String? = null
        for (attempt in 0 until 3) {
            b64 = capture()
            if (b64 != null) break
            if (attempt < 2) sleep(100)
        }
        if (b64 == null) {
            return CmdOutcome(false, CommandProtocol.ERR_CAPTURE_FAILED, mapOf("detail" to "busy_or_blank_after_3_attempts"))
        }
        val (sw, sh) = screenSize()
        val (cw, ch) = computeCaptureDims(sw, sh)
        return CmdOutcome(
            true,
            data = mapOf(
                "imageBase64" to b64,
                "captureWidth" to cw, "captureHeight" to ch,
                "screenWidth" to sw, "screenHeight" to sh,
            ),
        )
    }

    companion object {
        /** 与 ScreenCaptureReal.MAX_DIMENSION_PX / scaleDownIfNeeded 保持一致（toInt 截断 + 下限 1，已核对）。 */
        const val MAX_DIMENSION_PX = 720

        fun computeCaptureDims(w: Int, h: Int, maxDim: Int = MAX_DIMENSION_PX): Pair<Int, Int> {
            val longEdge = maxOf(w, h)
            if (longEdge <= maxDim || longEdge <= 0) return w to h
            val scale = maxDim.toFloat() / longEdge
            return (w * scale).toInt().coerceAtLeast(1) to (h * scale).toInt().coerceAtLeast(1)
        }
    }
}
