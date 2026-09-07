package com.zenithjoy.agent.command

/**
 * open_search 指令：定位搜索入口 → 点击 → 写入关键词 → 提交搜索。
 * 回调由 AgentService 装配，本类不碰 AccessibilityNodeInfo 以便纯单测。
 * typeKeyword: null=没找到输入框；true/false=ACTION_SET_TEXT 执行结果。
 */
class OpenSearchRunner(
    private val foregroundPkg: () -> String?,
    private val whitelist: Set<String>,
    private val openSearchEntry: suspend () -> Boolean?,
    private val typeKeyword: suspend (String) -> Boolean?,
    private val submitSearch: suspend () -> Boolean,
) {
    suspend fun run(keyword: String): CmdOutcome {
        val pkg = foregroundPkg()
        if (pkg == null || pkg !in whitelist) {
            return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to (pkg ?: "unknown")))
        }
        if (openSearchEntry() != true) {
            return CmdOutcome(false, CommandProtocol.ERR_SEARCH_ENTRY_NOT_FOUND)
        }
        when (typeKeyword(keyword)) {
            null -> return CmdOutcome(false, CommandProtocol.ERR_NO_FOCUSED_EDITABLE)
            false -> return CmdOutcome(false, CommandProtocol.ERR_SET_TEXT_FAILED)
            true -> Unit
        }
        if (!submitSearch()) {
            return CmdOutcome(false, CommandProtocol.ERR_SEARCH_SUBMIT_FAILED)
        }
        return CmdOutcome(true)
    }
}
