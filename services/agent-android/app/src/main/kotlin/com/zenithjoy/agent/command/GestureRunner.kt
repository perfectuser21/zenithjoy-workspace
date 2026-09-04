package com.zenithjoy.agent.command

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * tap/swipe 执行封装。判定点（decision「tap/swipe 手势成功判定」）：必须用
 * GestureResultCallback 三态，不能沿用全仓 9 处「dispatch 提交即成功」的旧姿势
 * ——那会把 GESTURE_CANCELLED（如恰逢用户手指触屏）谎报成功，AI 循环基于假成功推理。
 *
 * dispatch 抽象：生产实现构造 GestureDescription 并注册回调（onCompleted→onResult(true)、
 * onCancelled→onResult(false)），返回 dispatchGesture 的 Boolean；服务未绑定返回 false。
 */
class GestureRunner(
    private val dispatch: (points: List<Pair<Float, Float>>, durationMs: Long, onResult: (Boolean) -> Unit) -> Boolean,
    private val timeoutMs: Long = 5_000L,
) {
    suspend fun run(points: List<Pair<Float, Float>>, durationMs: Long): CmdOutcome {
        val done = CompletableDeferred<Boolean>()
        val submitted = try {
            dispatch(points, durationMs) { done.complete(it) }
        } catch (e: Exception) {
            return CmdOutcome(false, CommandProtocol.ERR_EXEC_EXCEPTION, mapOf("detail" to (e.message ?: e.javaClass.simpleName)))
        }
        if (!submitted) return CmdOutcome(false, CommandProtocol.ERR_SERVICE_NOT_READY)
        return when (withTimeoutOrNull(timeoutMs) { done.await() }) {
            true -> CmdOutcome(true)
            false -> CmdOutcome(false, CommandProtocol.ERR_GESTURE_CANCELLED)
            null -> CmdOutcome(false, CommandProtocol.ERR_GESTURE_TIMEOUT)
        }
    }
}
