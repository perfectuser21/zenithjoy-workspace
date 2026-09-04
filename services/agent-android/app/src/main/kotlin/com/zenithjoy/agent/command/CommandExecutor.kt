package com.zenithjoy.agent.command

/**
 * 指令路由与执行门禁。层次：远程协助开关（敏感指令 screenshot/type/tree_dump）
 * → 原生互斥门（变更类指令 tap/swipe/type/key/launch 在 ScanMutex.busy 时拒）
 * → 远程租约续租 → 分发到 Runner。一切异常转 EXEC_EXCEPTION 回执，
 * 绝不崩无障碍服务（0824 Path 负界崩溃前科）。
 */
class CommandExecutor(
    private val remoteControlEnabled: () -> Boolean,
    private val nativeBusy: () -> Boolean,
    private val foregroundPkg: () -> String?,
    private val gesture: GestureRunner,
    private val screenshot: ScreenshotRunner,
    private val type: TypeRunner,
    private val launch: LaunchRunner,
    private val globalAction: (String) -> Boolean,
    private val deviceInfo: () -> Map<String, Any?>,
    private val treeDump: () -> Map<String, Any?>?,
) {
    private val mutating = setOf(CmdAction.TAP, CmdAction.SWIPE, CmdAction.TYPE, CmdAction.KEY, CmdAction.LAUNCH)
    private val sensitive = setOf(CmdAction.SCREENSHOT, CmdAction.TYPE, CmdAction.TREE_DUMP)

    suspend fun execute(req: CmdRequest): Map<String, Any?> {
        val outcome = try {
            executeInner(req)
        } catch (e: Exception) {
            CmdOutcome(false, CommandProtocol.ERR_EXEC_EXCEPTION, mapOf("detail" to (e.message ?: e.javaClass.simpleName)))
        }
        val fg = try { foregroundPkg() } catch (_: Exception) { null }
        return CommandProtocol.buildResult(req.msgId, outcome, fg)
    }

    private suspend fun executeInner(req: CmdRequest): CmdOutcome {
        if (req.action in sensitive && !remoteControlEnabled()) {
            return CmdOutcome(false, CommandProtocol.ERR_REMOTE_CONTROL_DISABLED)
        }
        if (req.action in mutating) {
            if (nativeBusy()) return CmdOutcome(false, CommandProtocol.ERR_DEVICE_BUSY_NATIVE)
            if (!AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)) {
                return CmdOutcome(false, CommandProtocol.ERR_DEVICE_BUSY_NATIVE)
            }
        }
        return when (req.action) {
            CmdAction.SCREENSHOT -> screenshot.run()
            CmdAction.TAP -> {
                val x = (req.args["x"] as Number).toFloat()
                val y = (req.args["y"] as Number).toFloat()
                gesture.run(listOf(x to y), durationMs = 50L)
            }
            CmdAction.SWIPE -> {
                val p1 = (req.args["x1"] as Number).toFloat() to (req.args["y1"] as Number).toFloat()
                val p2 = (req.args["x2"] as Number).toFloat() to (req.args["y2"] as Number).toFloat()
                gesture.run(listOf(p1, p2), durationMs = (req.args["durationMs"] as Number).toLong())
            }
            CmdAction.TYPE -> type.run(req.args["text"] as String)
            CmdAction.KEY -> if (globalAction(req.args["name"] as String)) CmdOutcome(true)
                else CmdOutcome(false, CommandProtocol.ERR_SERVICE_NOT_READY)
            CmdAction.LAUNCH -> launch.run(req.args["pkg"] as String)
            CmdAction.DEVICE_INFO -> CmdOutcome(true, data = deviceInfo())
            CmdAction.TREE_DUMP -> treeDump()?.let { CmdOutcome(true, data = it) }
                ?: CmdOutcome(false, CommandProtocol.ERR_TREE_UNAVAILABLE)
        }
    }
}
