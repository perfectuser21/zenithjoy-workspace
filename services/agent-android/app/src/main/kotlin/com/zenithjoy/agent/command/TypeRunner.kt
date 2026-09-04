package com.zenithjoy.agent.command

/**
 * type 指令：向当前焦点可编辑节点 SET_TEXT（整段替换语义）。
 * 白名单硬红线：前台包不在白名单（首版只放抖音系）一律拒——type+launch 组合
 * 否则可对任意 app（银行/短信）注入文本。
 * setTextOnFocusedEditable 契约：null=无焦点可编辑节点；true/false=SET_TEXT 执行结果。
 */
class TypeRunner(
    private val foregroundPkg: () -> String?,
    private val whitelist: Set<String>,
    private val setTextOnFocusedEditable: (String) -> Boolean?,
) {
    fun run(text: String): CmdOutcome {
        val pkg = foregroundPkg()
        if (pkg == null || pkg !in whitelist) {
            return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to (pkg ?: "unknown")))
        }
        return when (setTextOnFocusedEditable(text)) {
            null -> CmdOutcome(false, CommandProtocol.ERR_NO_FOCUSED_EDITABLE)
            true -> CmdOutcome(true)
            false -> CmdOutcome(false, CommandProtocol.ERR_SET_TEXT_FAILED)
        }
    }
}
