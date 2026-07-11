package com.zenithjoy.agent.collect

/**
 * Bug C 剪贴板取链路线的纯判定逻辑（不碰 Android API，JVM 可单测）。
 * 剪贴板残留会静默产生"合法但错误"的 share_url（=系统性造假 id），故新鲜度用
 * 时间戳 + 去重双闸；面板/按钮判定用内容锚点，避免把详情页误当分享面板。
 */
object ClipboardCaptureGate {

    const val LEGACY_ACTION_SEND_TOKEN = -1L

    val SHARE_LINK_LABELS = listOf("分享链接", "复制链接", "口令")
    private val PANEL_ANCHORS = listOf("取消", "发送给朋友")

    fun matchShareLinkLabel(text: String?, contentDesc: String?): Boolean {
        val hit = { s: String? -> s != null && SHARE_LINK_LABELS.any { s.startsWith(it) } }
        return hit(text) || hit(contentDesc)
    }

    fun isSharePanel(nodeTexts: List<String>): Boolean {
        if (nodeTexts.any { t -> PANEL_ANCHORS.any { t.startsWith(it) } }) return true
        val labelHits = nodeTexts.count { t -> SHARE_LINK_LABELS.any { t.startsWith(it) } }
        return labelHits >= 2
    }

    fun isFresh(clipTimestampMs: Long, clickTimestampMs: Long): Boolean =
        clipTimestampMs > clickTimestampMs

    fun isDuplicate(url: String, seen: Set<String>): Boolean = url in seen

    fun acceptDelivery(deliveryToken: Long, expectedToken: Long): Boolean =
        deliveryToken == expectedToken || deliveryToken == LEGACY_ACTION_SEND_TOKEN
}
