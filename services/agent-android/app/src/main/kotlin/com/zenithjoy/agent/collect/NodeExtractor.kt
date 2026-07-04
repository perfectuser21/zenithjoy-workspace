package com.zenithjoy.agent.collect

/**
 * 从 AccessibilityNodeInfo 扁平化的节点列表中提取抖音主页字段。
 *
 * 设计原则：
 *   - 纯函数，不持有 Android 框架依赖，可在 JVM 单测中覆盖。
 *   - 对齐 uiautomator dump 文本提取方案：dump 节点同样暴露 text / contentDescription / resourceId。
 *   - 优先用 resourceId 精确匹配；fallback 用文本启发。
 *
 * 节点模型抽象为 [NodeInfo]，生产侧由 DouyinCollectService 从真实 AccessibilityNodeInfo 适配。
 */
object NodeExtractor {

    data class NodeInfo(
        val text: String,
        val contentDescription: String,
        val resourceId: String,
    )

    data class ProfileFields(
        val nickname: String,
        val douyinId: String,
        val followersCount: String,
        val bio: String,
    )

    private val DOUYIN_PKG = "com.ss.android.ugc.aweme"

    fun extract(nodes: List<NodeInfo>): ProfileFields {
        val nickname = extractNickname(nodes)
        val douyinId = extractDouyinId(nodes)
        val followersCount = extractFollowers(nodes)
        val bio = extractBio(nodes)
        return ProfileFields(nickname, douyinId, followersCount, bio)
    }

    // ── 昵称 ─────────────────────────────────────────────────────────────────

    private fun extractNickname(nodes: List<NodeInfo>): String {
        // resource-id 精确匹配（不同版本 resource-id 可能变化，多候选）
        val byId = nodes.firstOrNull { n ->
            n.resourceId.endsWith(":id/tv_user_nickname") ||
                n.resourceId.endsWith(":id/nickname") ||
                n.resourceId.endsWith(":id/user_name")
        }
        if (byId != null && byId.text.isNotBlank()) return byId.text.trim()

        // contentDescription 启发：主页头部有 "xxx的主页" 模式
        val byDesc = nodes.firstOrNull { n ->
            n.contentDescription.endsWith("的主页") && n.contentDescription.length in 3..40
        }
        if (byDesc != null) return byDesc.contentDescription.removeSuffix("的主页").trim()

        return ""
    }

    // ── 抖音号 ───────────────────────────────────────────────────────────────

    private val DOUYIN_ID_PREFIX_RE = Regex("""(?:抖音号[：:]\s*)(\S+)""")

    private fun extractDouyinId(nodes: List<NodeInfo>): String {
        // 专用 resource-id
        val byId = nodes.firstOrNull { n ->
            n.resourceId.endsWith(":id/tv_user_uniqueid") ||
                n.resourceId.endsWith(":id/unique_id") ||
                n.resourceId.endsWith(":id/user_uniqueid")
        }
        if (byId != null && byId.text.isNotBlank()) return byId.text.trim()

        // 文本启发："抖音号：xxx"
        for (n in nodes) {
            val src = n.text.ifBlank { n.contentDescription }
            val m = DOUYIN_ID_PREFIX_RE.find(src) ?: continue
            val id = m.groupValues[1].trim()
            if (id.isNotBlank()) return id
        }
        return ""
    }

    // ── 粉丝数 ───────────────────────────────────────────────────────────────

    private fun extractFollowers(nodes: List<NodeInfo>): String {
        // resource-id 精确
        val byId = nodes.firstOrNull { n ->
            n.resourceId.endsWith(":id/tv_fans_count") ||
                n.resourceId.endsWith(":id/follower_count") ||
                n.resourceId.endsWith(":id/fans_count")
        }
        if (byId != null && byId.text.isNotBlank()) return byId.text.trim()

        // contentDescription 启发："xxx 粉丝" 或 "粉丝 xxx"
        val fansDescRe = Regex("""^([\d.万千亿kKwW,]+)\s*粉丝$""")
        for (n in nodes) {
            val src = n.contentDescription.ifBlank { n.text }
            val m = fansDescRe.matchEntire(src.trim()) ?: continue
            return m.groupValues[1]
        }

        // 相邻节点法：找到文本为"粉丝"的节点，取其前一个兄弟的数字
        val fansLabelIdx = nodes.indexOfFirst { n ->
            n.text.trim() == "粉丝" || n.contentDescription.trim() == "粉丝"
        }
        if (fansLabelIdx > 0) {
            val prev = nodes[fansLabelIdx - 1]
            val countText = prev.text.ifBlank { prev.contentDescription }
            if (countText.isNotBlank()) return countText.trim()
        }

        return ""
    }

    // ── 简介 ─────────────────────────────────────────────────────────────────

    private fun extractBio(nodes: List<NodeInfo>): String {
        val byId = nodes.firstOrNull { n ->
            n.resourceId.endsWith(":id/tv_user_desc") ||
                n.resourceId.endsWith(":id/user_desc") ||
                n.resourceId.endsWith(":id/user_bio") ||
                n.resourceId.endsWith(":id/desc")
        }
        if (byId != null && byId.text.isNotBlank()) return byId.text.trim()

        // 无 resourceId 时：text ≥ 10 字且不含 @ 的段落（常见简介特征）
        return nodes.filter { n ->
            n.resourceId.isEmpty() &&
                n.text.length >= 10 &&
                !n.text.startsWith("@") &&
                !n.text.contains("粉丝") &&
                !n.text.contains("关注") &&
                !n.text.contains("获赞")
        }.maxByOrNull { it.text.length }?.text?.trim() ?: ""
    }
}
