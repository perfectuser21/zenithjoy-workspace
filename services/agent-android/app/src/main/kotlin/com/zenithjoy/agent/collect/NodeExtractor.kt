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
 * 提取策略——**只按 avatar 锚定切段，没有启发式 fallback**：
 *   评论 item 在 DFS 前序里恒为 `avatar → title → [eyo] → content` 连续排列，
 *   因此用 avatar 当分隔符切段即可，不需要父子信息。
 *   容器 id（fgd/k4x）会随楼中楼互换嵌套，**不可用来认评论**。
 *
 *   锚定不到 → 返回空列表（调用方 DouyinCollectService 已有"空即失败"的重试/上报路径）。
 *   **绝不猜**：历史上这里有个"相邻短文本+长文本配对"的结构启发式 fallback，
 *   因 nicknameIds 猜错（真机是 title，候选集里一个都没有）而被恒定触发，
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

    /** 累积中的一条评论 item（从一个 avatar 开始，到下一个 avatar 结束）。 */
    private data class PendingItem(
        var nickname: String? = null,
        var content: String? = null,
        var isAuthor: Boolean = false,
    )

    fun extractComments(nodes: List<NodeInfo>): List<CommentEntry> {
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
}
