package com.zenithjoy.agent.collect

/**
 * 从 AccessibilityNodeInfo 扁平化的节点列表中提取抖音评论区字段。
 *
 * 设计原则：
 *   - 纯函数，不持有 Android 框架依赖，可在 JVM 单测中覆盖。
 *   - 对齐 uiautomator dump 文本提取方案：dump 节点同样暴露 text / contentDescription / resourceId。
 *   - 优先用 resourceId 精确匹配；resourceId 候选值未经真机验证（今天调试时系统权限弹窗
 *     挡住了评论区节点树的现场抓取），上线前必须用真机 uiautomator dump 核实实际 id，
 *     这里同时保留结构启发式 fallback（昵称节点后紧跟的正文节点）兜底。
 *
 * 节点模型抽象为 [NodeInfo]，生产侧由 DouyinCollectService 从真实 AccessibilityNodeInfo 适配。
 */
object NodeExtractor {

    data class NodeInfo(
        val text: String,
        val contentDescription: String,
        val resourceId: String,
    )

    fun extractComments(nodes: List<NodeInfo>): List<CommentEntry> {
        val byId = extractByResourceId(nodes)
        if (byId.isNotEmpty()) return byId
        return extractByStructure(nodes)
    }

    // ── 方案一：resourceId 精确匹配（候选值待真机核实） ─────────────────────────

    private fun extractByResourceId(nodes: List<NodeInfo>): List<CommentEntry> {
        val nicknameIds = setOf(
            "tv_username", "tv_user_name", "comment_user_name", "nick_name",
        )
        val contentIds = setOf(
            "tv_comment_content", "comment_content", "tv_content", "content",
        )

        val entries = mutableListOf<CommentEntry>()
        var pendingNickname: String? = null
        for (n in nodes) {
            val idTail = n.resourceId.substringAfterLast("/")
            if (idTail in nicknameIds && n.text.isNotBlank()) {
                pendingNickname = n.text.trim()
                continue
            }
            if (idTail in contentIds && n.text.isNotBlank() && pendingNickname != null) {
                entries.add(CommentEntry(commenterId = pendingNickname, text = n.text.trim()))
                pendingNickname = null
            }
        }
        return entries
    }

    // ── 方案二：结构启发式 fallback（没有可靠 resourceId 时） ───────────────────
    //
    // 抖音评论列表项通常渲染顺序为：头像(无文字) → 昵称(短文本,常以数字/字母/中文名开头,
    // 不含标点) → 正文(较长文本) → 元信息(如 "3天前"/"回复"/点赞数)。
    // 用"短文本后紧跟一个较长文本"的相邻关系配对，比强行猜 resourceId 更稳。

    private val META_WORDS = setOf("回复", "赞", "展开", "点赞", "更多回复")
    private val NICKNAME_LEN_RANGE = 1..20
    private val CONTENT_MIN_LEN = 1

    private fun extractByStructure(nodes: List<NodeInfo>): List<CommentEntry> {
        val entries = mutableListOf<CommentEntry>()
        var i = 0
        while (i < nodes.size - 1) {
            val candidate = nodes[i]
            val nextText = nodes[i + 1]
            val nickname = candidate.text.trim()
            val content = nextText.text.trim()

            val looksLikeNickname = nickname.isNotBlank() &&
                nickname.length in NICKNAME_LEN_RANGE &&
                !nickname.contains("：") && !nickname.contains(":") &&
                nickname !in META_WORDS

            val looksLikeContent = content.length >= CONTENT_MIN_LEN &&
                content !in META_WORDS &&
                !content.matches(Regex("""^\d+[天小时分钟秒]前$"""))

            if (looksLikeNickname && looksLikeContent) {
                entries.add(CommentEntry(commenterId = nickname, text = content))
                i += 2
            } else {
                i += 1
            }
        }
        return entries
    }
}
