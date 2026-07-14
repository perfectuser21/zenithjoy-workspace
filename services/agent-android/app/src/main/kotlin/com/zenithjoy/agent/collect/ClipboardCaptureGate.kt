package com.zenithjoy.agent.collect

/**
 * Bug C 剪贴板取链路线的纯判定逻辑（不碰 Android API，JVM 可单测）。
 * 剪贴板残留会静默产生"合法但错误"的 share_url（=系统性造假 id），故新鲜度用
 * 时间戳 + 去重双闸；面板/按钮判定用内容锚点，避免把详情页误当分享面板。
 */
object ClipboardCaptureGate {

    const val LEGACY_ACTION_SEND_TOKEN = -1L

    // ACTION_SEND 旧路径无真实 clip 时间戳，用该 sentinel 让时间戳闸直接放行——
    // 与 LEGACY_ACTION_SEND_TOKEN 同思路：legacy 投递不因缺时间戳被误杀。
    const val LEGACY_CLIP_TIMESTAMP_MS = Long.MAX_VALUE

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

    // 新鲜度闸：剪贴板写入时刻必须晚于点"分享链接"的时刻，否则=残留旧短链（串号造假源）。
    // clipTs/clickTs 都必须取自 SystemClock.uptimeMillis()（ClipDescription.getTimestamp()
    // 的时间基）——绝不能混用 elapsedRealtime()（含深睡时间、绝对值偏大，会把新鲜短链误判陈旧）。
    // legacy 投递(clipTs==LEGACY_CLIP_TIMESTAMP_MS)豁免。
    fun isFresh(clipTimestampMs: Long, clickTimestampMs: Long): Boolean =
        clipTimestampMs == LEGACY_CLIP_TIMESTAMP_MS || clipTimestampMs > clickTimestampMs

    fun isDuplicate(url: String, seen: Set<String>): Boolean = url in seen

    /**
     * 剪贴板短链准入判定（生产链路第 9 步的唯一决策点）：新鲜度 + 去重双闸都过才收。
     * 残留旧短链(clipTs ≤ clickTs)或已见过的 url 一律拒——宁可漏采不可串号造假。
     */
    fun admitShareUrl(url: String, clipTimestampMs: Long, clickTimestampMs: Long, seen: Set<String>): Boolean =
        isFresh(clipTimestampMs, clickTimestampMs) && !isDuplicate(url, seen)

    fun acceptDelivery(deliveryToken: Long, expectedToken: Long): Boolean =
        deliveryToken == expectedToken || deliveryToken == LEGACY_ACTION_SEND_TOKEN

    /** 节点在屏坐标（纯数据，供选择逻辑单测，不碰 android.graphics.Rect）。 */
    data class NodeBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val isEmpty: Boolean get() = left >= right || top >= bottom
        val centerX: Int get() = (left + right) / 2
        val centerY: Int get() = (top + bottom) / 2
    }

    /**
     * 从同名候选按钮里选【在屏可见】的那个的下标。
     *
     * 真机根因(2026-07-14)：抖音详情页竖向翻页器的无障碍树含相邻视频（屏幕外）的同名
     * 「分享」按钮，其 bounds 为空矩形(bottom<top，dump 里 b=197x-193)或超出屏幕。
     * BFS 取首个会命中屏幕外节点，tapNodeCenter 因 bounds.isEmpty 静默跳过不点 → 面板不弹。
     *
     * 选择顺序：首个「非空 bounds 且中心落在屏内」的候选；全不在屏 → -1（不点，避免空点浪费一次卡）。
     */
    fun pickVisibleShareButtonIndex(boxes: List<NodeBox>, screenW: Int, screenH: Int): Int {
        for (i in boxes.indices) {
            val b = boxes[i]
            if (!b.isEmpty && b.centerX in 0..screenW && b.centerY in 0..screenH) return i
        }
        return -1
    }
}
