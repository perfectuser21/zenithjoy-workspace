package com.zenithjoy.agent.collect

/**
 * 评论人头像结构定位（纯逻辑，可 JVM 单测）——Brain task 28cee213，2026-08-16 4号机真机实证。
 *
 * 抖音新版评论条目的头像 ImageView **无 resource-id、无 content-desc**（旧锚
 * `"<昵称>的头像"` 失效），但布局稳定：头像圆在昵称 TextView 的左侧、同一行垂直居中。
 * 因此以昵称节点 bounds 为准，往左取一个点击点；昵称已经贴着面板左缘（左边放不下头像）→ null。
 */
object CommentAvatarLocator {
    /** 头像中心距昵称左缘的水平偏移（真机 dump：昵称 left=193，头像圆心 x≈120–130）。 */
    private const val AVATAR_OFFSET_X = 70

    /** 昵称左缘距面板左缘不足此值 → 左边放不下头像，判定为无头像（避免误点面板边缘/其它控件）。 */
    private const val MIN_ROOM_FOR_AVATAR = 100

    fun tapPointLeftOfNickname(left: Int, top: Int, right: Int, bottom: Int, panelLeft: Int): Pair<Int, Int>? {
        if (right <= left || bottom <= top) return null
        if (left - panelLeft < MIN_ROOM_FOR_AVATAR) return null
        val x = left - AVATAR_OFFSET_X
        val y = top + (bottom - top) / 2
        return x to y
    }

    /** 评论面板结构判据：有 "N条评论" 标题，或同时有「回复」动作文本（主页/详情页都没有这一组）。 */
    fun looksLikeCommentPanel(texts: List<String>): Boolean {
        val trimmed = texts.map { it.trim() }
        if (trimmed.any { it.endsWith("条评论") }) return true
        return trimmed.any { it == "回复" }
    }
}
