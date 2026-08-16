package com.zenithjoy.agent.collect

/**
 * 从 AccessibilityNodeInfo 扁平化的节点列表中提取抖音评论区字段。
 *
 * 设计原则：
 *   - 纯函数，不持有 Android 框架依赖，可在 JVM 单测中覆盖。
 *   - 对齐 uiautomator dump 文本提取方案：dump 节点同样暴露 text / contentDescription / resourceId。
 *   - resourceId 已于 2026-07-15 用真机 uiautomator dump 核实（fixture 在
 *     app/src/test/resources/fixtures/douyin-comment-panel-20260715.xml）：
 *     真机 id 为 avatar / title / content / eyo。
 *
 * 提取策略——**两重锚点，都不是启发式猜测**：
 *
 *   1) resourceId 锚定：评论 item 在 DFS 前序里恒为 `avatar → title → [eyo] → content`
 *      连续排列，用 avatar 当分隔符切段。容器 id（fgd/k4x）会随楼中楼互换嵌套，
 *      **不可用来认评论**。
 *
 *   2) content-desc 锚定（真机复现 2026-07-16）：同一台设备隔一天 resourceId 就从
 *      avatar/title/content/eyo 轮换成完全不同的混淆串（对比 fixture
 *      douyin-comment-panel-20260715.xml vs douyin-comment-panel-20260716-idrotated.xml），
 *      resourceId 锚定策略当场全线失效，三条视频抓评论全部"extracted 0 comments"。
 *      content-desc 是抖音给读屏无障碍用户用的结构化朗读文案，格式恒定：
 *        "<昵称>,<正文>,<日期>[, · <地区>],回复 按钮,[<其它标记>]"
 *      面向真实盲人用户朗读，不太可能像 resourceId 一样被当反爬手段轮换混淆，用它
 *      当第二重锚点：resourceId 命中就用 resourceId 那条，命中不了再解析 content-desc。
 *      "作者" 角标在 content-desc 里就是逗号分隔的中间字段；"购后评价" 标记商品购后
 *      评价（不是视频评论），同样按字段直接识别，不是猜。
 *
 *   两重锚点都锚不到 → 返回空列表（调用方 DouyinCollectService 已有"空即失败"的
 *   重试/上报路径）。**绝不猜**：历史上这里有个"相邻短文本+长文本配对"的结构启发式
 *   fallback，因 nicknameIds 猜错（真机是 title，候选集里一个都没有）而被恒定触发，
 *   把商品卡（"客厅多层花架"/"已售200+"）、tab 栏、博主置顶广告全配成 lead 写进库。
 *   宁可空，不可猜——空会硬失败并告警，猜出来的垃圾会静默污染 Lead 表。
 *
 * 节点模型抽象为 [NodeInfo]，生产侧由 DouyinCollectService 从真实 AccessibilityNodeInfo 适配。
 */
object NodeExtractor {

    data class NodeInfo(
        val text: String,
        val contentDescription: String,
        val resourceId: String,
    )

    // 真机核实过的 resourceId 尾段（2026-07-15 dump）。
    private const val ID_AVATAR = "avatar"
    private const val ID_TITLE = "title"
    private const val ID_CONTENT = "content"
    private const val ID_AUTHOR_BADGE = "eyo"

    /** 「作者」角标文案：标记该条评论出自博主本人，不是 lead。 */
    private const val AUTHOR_BADGE_TEXT = "作者"

    /** content-desc 锚点：只有真实评论 item 的容器才带这个朗读文案后缀。 */
    private const val CONTENT_DESC_REPLY_MARKER = "回复 按钮"

    /** content-desc 里的商品购后评价标记：不是视频评论，混在同一个评论面板里。 */
    private const val CONTENT_DESC_PURCHASE_REVIEW_MARKER = "购后评价"

    /** 累积中的一条评论 item（从一个 avatar 开始，到下一个 avatar 结束）。 */
    private data class PendingItem(
        var nickname: String? = null,
        var content: String? = null,
        var isAuthor: Boolean = false,
    )

    fun extractComments(nodes: List<NodeInfo>): List<CommentEntry> {
        val byResourceId = extractByResourceIdAnchor(nodes)
        val byContentDesc = extractByContentDescAnchor(nodes)
        val byStructure = extractByStructuralAnchor(nodes)

        // 合并去重（同一条评论多条锚点都命中时按 nickname+text 归一）：resourceId 锚点
        // 优先（历史上验证更久），content-desc 锚点补 resourceId 锚不到的那些，
        // 结构锚点兜底（2026-08-16 抖音新版评论条目两者皆无时唯一能用的锚）。
        val seen = mutableSetOf<Pair<String, String>>()
        val merged = mutableListOf<CommentEntry>()
        for (e in byResourceId + byContentDesc + byStructure) {
            if (seen.add(e.commenterId to e.text)) merged.add(e)
        }
        return merged
    }

    /** 结构锚点：评论 item 动作行里的「回复」按钮文本（精确匹配）。 */
    private const val STRUCT_REPLY_TEXT = "回复"

    /** 结构锚点：紧跟「回复」之后的点赞节点朗读文案前缀（"赞N,未选中"/"赞N,已选中"）。 */
    private const val STRUCT_LIKE_DESC_PREFIX = "赞"

    /** 「回复」之后允许隔几个节点出现点赞节点（真机 dump 里紧邻，留余量）。 */
    private const val STRUCT_LIKE_LOOKAHEAD = 3

    /** 从「回复」向前回溯昵称/正文时最多看多少个节点（防止跨到上一条评论）。 */
    private const val STRUCT_LOOKBACK = 12

    /** 昵称长度上限（抖音昵称 ≤ 20 字，留余量；正文通常更长）。 */
    private const val STRUCT_NICKNAME_MAX = 24

    private val STRUCT_DATE_REGEX = Regex(
        "^(\\d{1,2}-\\d{1,2}|\\d{4}-\\d{1,2}-\\d{1,2}|\\d+\\s*(天|小时|分钟|秒)前|昨天|前天|刚刚)$",
    )

    private fun isStructNoise(text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return true
        if (t == STRUCT_REPLY_TEXT) return true
        if (t.startsWith("·")) return true                                  // " · 广东" 地区（trim 后以 · 开头）
        if (STRUCT_DATE_REGEX.matches(t)) return true                       // 日期
        if (t.startsWith("展开") && t.endsWith("回复")) return true          // "展开N条回复"
        if (t.endsWith("条评论")) return true                                // "8383条评论" 标题
        return false
    }

    /**
     * 结构锚点（2026-08-16，4号机 MAA-AN00 真机 dump 实证）：抖音新版评论面板的条目
     * **没有 resource-id 也没有 content-desc**——昵称/正文/日期/地区都是裸 TextView，
     * 只有动作行的「回复」文本与「赞N,未选中」朗读文案稳定。DFS 扁平序列里每条评论固定为
     * `昵称 → 正文 → 日期 → [· 地区] → 回复 → 赞N(desc) → [数字] → 点踩`，楼中楼同构。
     *
     * 算法：以每个精确等于「回复」且其后 [STRUCT_LIKE_LOOKAHEAD] 个节点内出现「赞…」desc 的
     * 节点为锚，向前跳过日期/地区/空节点，取到的第一段文本为正文、再前一段为昵称；
     * 昵称超长、昵称正文相同、或回溯撞上另一个「回复」/「展开N条回复」则放弃这一条。
     * 「作者」角标（昵称与正文之间独立的"作者"文本）视为博主本人，跳过。
     */
    private fun extractByStructuralAnchor(nodes: List<NodeInfo>): List<CommentEntry> {
        val entries = mutableListOf<CommentEntry>()
        for ((i, n) in nodes.withIndex()) {
            if (n.text.trim() != STRUCT_REPLY_TEXT) continue
            val likeFollows = (i + 1..minOf(i + STRUCT_LIKE_LOOKAHEAD, nodes.lastIndex))
                .any { nodes[it].contentDescription.trim().startsWith(STRUCT_LIKE_DESC_PREFIX) }
            if (!likeFollows) continue

            var content: String? = null
            var nickname: String? = null
            var isAuthor = false
            var j = i - 1
            val floor = maxOf(0, i - STRUCT_LOOKBACK)
            while (j >= floor && nickname == null) {
                val t = nodes[j].text.trim()
                if (t.isNotEmpty()) {
                    if (t == STRUCT_REPLY_TEXT || (t.startsWith("展开") && t.endsWith("回复"))) break // 撞上上一条
                    if (!isStructNoise(t)) {
                        when {
                            content == null -> content = t
                            t == AUTHOR_BADGE_TEXT -> isAuthor = true
                            else -> nickname = t
                        }
                    }
                }
                j--
            }
            val nick = nickname?.trim().orEmpty()
            val body = content?.trim().orEmpty()
            if (nick.isEmpty() || body.isEmpty()) continue
            if (nick == body) continue
            if (nick.length > STRUCT_NICKNAME_MAX) continue
            if (isAuthor) continue
            entries.add(CommentEntry(commenterId = nick, text = body))
        }
        return entries
    }

    private fun extractByResourceIdAnchor(nodes: List<NodeInfo>): List<CommentEntry> {
        val entries = mutableListOf<CommentEntry>()
        // null = 还没遇到第一个 avatar，此前的节点（孤儿 content / 标题栏 / 商品卡）全部忽略。
        var current: PendingItem? = null

        fun flush(item: PendingItem?) {
            if (item == null) return
            val nickname = item.nickname?.trim().orEmpty()
            val content = item.content?.trim().orEmpty()
            // 产出条件：有昵称 && 正文非空 && 非博主本人。
            if (nickname.isNotEmpty() && content.isNotEmpty() && !item.isAuthor) {
                entries.add(CommentEntry(commenterId = nickname, text = content))
            }
        }

        for (n in nodes) {
            when (n.resourceId.substringAfterLast("/")) {
                ID_AVATAR -> {
                    flush(current)
                    current = PendingItem()
                }
                ID_TITLE -> {
                    val item = current ?: continue
                    if (item.nickname == null && n.text.isNotBlank()) {
                        item.nickname = n.text
                    }
                }
                ID_CONTENT -> {
                    val item = current ?: continue
                    if (item.content == null && n.text.isNotBlank()) {
                        item.content = n.text
                    }
                }
                ID_AUTHOR_BADGE -> {
                    val item = current ?: continue
                    if (n.text.trim() == AUTHOR_BADGE_TEXT) {
                        item.isAuthor = true
                    }
                }
            }
        }
        flush(current)
        return entries
    }

    /**
     * content-desc 锚点：抖音自己给评论 item 容器生成的朗读文案格式恒定为
     * "<昵称>,<正文>,<日期>[, · <地区>],回复 按钮,[<其它标记>]"，不随 resourceId 轮换。
     */
    private fun extractByContentDescAnchor(nodes: List<NodeInfo>): List<CommentEntry> {
        val entries = mutableListOf<CommentEntry>()
        for (n in nodes) {
            val cd = n.contentDescription
            if (!cd.contains(CONTENT_DESC_REPLY_MARKER)) continue
            if (cd.contains(CONTENT_DESC_PURCHASE_REVIEW_MARKER)) continue // 商品购后评价，不是视频评论

            val segments = cd.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            if (segments.size < 2) continue

            val nickname = segments[0]
            if (nickname.isEmpty()) continue

            // "作者" 是紧跟昵称后的独立字段（== 第二段），标记这条是博主本人发言，不是 lead。
            if (segments[1] == AUTHOR_BADGE_TEXT) continue

            val content = segments[1]
            if (content.isEmpty()) continue

            entries.add(CommentEntry(commenterId = nickname, text = content))
        }
        return entries
    }
}
