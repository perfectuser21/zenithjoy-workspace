package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 守卫（Brain task 28cee213，2026-08-16 4号机真机 dump）：抖音新版评论条目的头像 ImageView
 * 既无 resource-id 也无 content-desc（旧锚 "<昵称>的头像" 失效），抖音号回填 enrich 恒 0 →
 * 安卓通道派单缺抖音号 → dm_assignments 直接 limited。结构化定位：以昵称 TextView 的 bounds
 * 为准，在其左侧同一行给出头像点击点；回评论面板的判据也不能只靠 id/avatar 计数。
 */
class CommentAvatarLocatorTest {

    @Test
    fun `tap point is left of nickname on the same row (real dump bounds)`() {
        // 08-16 dump：昵称「唯一」bounds [193,1095][277,1150]，头像在其左侧约 x 90~180 的圆
        val p = CommentAvatarLocator.tapPointLeftOfNickname(left = 193, top = 1095, right = 277, bottom = 1150, panelLeft = 0)
        assertEquals(1122, p!!.second)                 // 垂直居中于昵称行
        assertTrue("x 应落在昵称左侧头像区: ${p.first}", p.first in 60..170)
    }

    @Test
    fun `nickname too close to panel edge yields null (no room for an avatar)`() {
        assertNull(CommentAvatarLocator.tapPointLeftOfNickname(left = 30, top = 100, right = 120, bottom = 150, panelLeft = 0))
    }

    @Test
    fun `comment panel is recognised by structural signals without id-avatar`() {
        val texts = listOf("8383条评论", "唯一", "新房装修，到底选择自主装修…", "3天前", "回复")
        assertTrue(CommentAvatarLocator.looksLikeCommentPanel(texts))
        assertFalse(CommentAvatarLocator.looksLikeCommentPanel(listOf("抖音号：1689210742", "关注", "粉丝")))
    }
}
