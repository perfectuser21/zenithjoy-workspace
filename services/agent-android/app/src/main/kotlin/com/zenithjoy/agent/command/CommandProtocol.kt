package com.zenithjoy.agent.command

/** 指令动作集（对齐设计文档 8 指令）。 */
enum class CmdAction { SCREENSHOT, TAP, SWIPE, TYPE, KEY, LAUNCH, DEVICE_INFO, TREE_DUMP }

data class CmdRequest(val msgId: String, val action: CmdAction, val args: Map<String, Any?>)

/** 单条指令执行结果（执行层内部表示，经 buildResult 转回执 map）。 */
data class CmdOutcome(val ok: Boolean, val errorCode: String? = null, val data: Map<String, Any?> = emptyMap())

sealed class ParseOutcome {
    data class Ok(val request: CmdRequest) : ParseOutcome()
    data class Err(val code: String, val detail: String) : ParseOutcome()
}

object CommandProtocol {
    const val ERR_BAD_REQUEST = "BAD_REQUEST"
    const val ERR_UNKNOWN_ACTION = "UNKNOWN_ACTION"
    const val ERR_COORD_OUT_OF_BOUNDS = "COORD_OUT_OF_BOUNDS"
    const val ERR_QUEUE_FULL = "QUEUE_FULL"
    const val ERR_REMOTE_CONTROL_DISABLED = "REMOTE_CONTROL_DISABLED"
    const val ERR_DEVICE_BUSY_NATIVE = "DEVICE_BUSY_NATIVE"
    const val ERR_GESTURE_CANCELLED = "GESTURE_CANCELLED"
    const val ERR_GESTURE_TIMEOUT = "GESTURE_TIMEOUT"
    const val ERR_SERVICE_NOT_READY = "SERVICE_NOT_READY"
    const val ERR_NOT_INITIALIZED = "NOT_INITIALIZED"
    const val ERR_NEED_USER_REAUTH = "NEED_USER_REAUTH"
    const val ERR_CAPTURE_FAILED = "CAPTURE_FAILED"
    const val ERR_NO_FOCUSED_EDITABLE = "NO_FOCUSED_EDITABLE"
    const val ERR_SET_TEXT_FAILED = "SET_TEXT_FAILED"
    const val ERR_REFUSED_PACKAGE = "REFUSED_PACKAGE"
    const val ERR_PACKAGE_NOT_FOUND = "PACKAGE_NOT_FOUND"
    const val ERR_LAUNCH_FAILED = "LAUNCH_FAILED"
    const val ERR_LAUNCH_NOT_FOREGROUND = "LAUNCH_NOT_FOREGROUND"
    const val ERR_EXEC_EXCEPTION = "EXEC_EXCEPTION"
    const val ERR_TREE_UNAVAILABLE = "TREE_UNAVAILABLE"

    private const val MIN_SWIPE_MS = 50L
    private const val MAX_SWIPE_MS = 10_000L
    private const val DEFAULT_SWIPE_MS = 300L

    fun parse(msgId: String?, payload: Map<*, *>, screenW: Int, screenH: Int): ParseOutcome {
        if (msgId.isNullOrEmpty()) return ParseOutcome.Err(ERR_BAD_REQUEST, "missing msgId")
        val action = when ((payload["action"] as? String)?.lowercase()) {
            "screenshot" -> CmdAction.SCREENSHOT
            "tap" -> CmdAction.TAP
            "swipe" -> CmdAction.SWIPE
            "type" -> CmdAction.TYPE
            "key" -> CmdAction.KEY
            "launch" -> CmdAction.LAUNCH
            "device_info" -> CmdAction.DEVICE_INFO
            "tree_dump" -> CmdAction.TREE_DUMP
            else -> return ParseOutcome.Err(ERR_UNKNOWN_ACTION, "action=${payload["action"]}")
        }
        val args = mutableMapOf<String, Any?>()
        when (action) {
            CmdAction.TAP -> {
                val x = num(payload["x"]) ?: return bad("missing x")
                val y = num(payload["y"]) ?: return bad("missing y")
                if (x < 0 || y < 0 || x >= screenW || y >= screenH) {
                    return ParseOutcome.Err(ERR_COORD_OUT_OF_BOUNDS, "($x,$y) vs ${screenW}x$screenH")
                }
                args["x"] = x; args["y"] = y
            }
            CmdAction.SWIPE -> {
                val pts = listOf("x1", "y1", "x2", "y2").map { num(payload[it]) ?: return bad("missing $it") }
                if (pts[0] < 0 || pts[2] < 0 || pts[0] >= screenW || pts[2] >= screenW ||
                    pts[1] < 0 || pts[3] < 0 || pts[1] >= screenH || pts[3] >= screenH
                ) return ParseOutcome.Err(ERR_COORD_OUT_OF_BOUNDS, "swipe pts vs ${screenW}x$screenH")
                args["x1"] = pts[0]; args["y1"] = pts[1]; args["x2"] = pts[2]; args["y2"] = pts[3]
                val dur = (payload["durationMs"] as? Number)?.toLong() ?: DEFAULT_SWIPE_MS
                args["durationMs"] = dur.coerceIn(MIN_SWIPE_MS, MAX_SWIPE_MS)
            }
            CmdAction.TYPE -> {
                val text = payload["text"] as? String ?: return bad("missing text")
                args["text"] = text
            }
            CmdAction.KEY -> {
                val name = (payload["name"] as? String)?.lowercase()
                if (name != "back" && name != "home") return bad("key name must be back|home")
                args["name"] = name
            }
            CmdAction.LAUNCH -> {
                val pkg = payload["pkg"] as? String
                if (pkg.isNullOrEmpty()) return bad("missing pkg")
                args["pkg"] = pkg
            }
            else -> Unit // screenshot / device_info / tree_dump 无参数
        }
        return ParseOutcome.Ok(CmdRequest(msgId, action, args))
    }

    fun buildResult(inReplyTo: String, outcome: CmdOutcome, foregroundPkg: String?): Map<String, Any?> =
        mutableMapOf<String, Any?>(
            "inReplyTo" to inReplyTo,
            "ok" to outcome.ok,
            "foregroundPkg" to foregroundPkg,
        ).apply {
            if (outcome.errorCode != null) put("errorCode", outcome.errorCode)
            if (outcome.data.isNotEmpty()) put("data", outcome.data)
        }

    private fun num(v: Any?): Int? = (v as? Number)?.toInt()
    private fun bad(detail: String) = ParseOutcome.Err(ERR_BAD_REQUEST, detail)
}
