package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 守卫（Brain task 28cee213，2026-08-16 4号机真机 DUMP[detail]）：抖音视频详情页是竖向 feed，
 * 无障碍树里同时存在**上一条/下一条视频**的动作栏节点，它们的 content-desc 同样是"评论N，按钮"，
 * 但 bounds 在屏幕外（top 为负 / bottom 超屏）。旧逻辑 `findNodeByContentDescPrefix(root,"评论")`
 * 取 DFS 第一个命中 → 点在屏幕外 → 评论面板没开 → extracted 0 comments。
 * 本测试锁定：只能选屏幕内可见的评论按钮；多个可见时选最靠下（当前视频动作栏）；没有可见的返回 null。
 */
class CommentButtonPickerTest {

    private fun c(i: Int, top: Int, bottom: Int, visible: Boolean = true) =
        CommentButtonPicker.Candidate(index = i, top = top, bottom = bottom, visibleToUser = visible)

    @Test
    fun `picks the on-screen comment button, not the off-screen neighbours (real dump bounds)`() {
        // DUMP[detail] 08-16：评论1818 b=197x-633（上一条视频）/ 评论1693 b=197x219（当前）/ 评论613 b=197x-1652
        val cands = listOf(c(0, -633, -414), c(1, 219, 438), c(2, -1652, -1433))
        assertEquals(1, CommentButtonPicker.pick(cands, screenHeight = 2664))
    }

    @Test
    fun `off-screen bottom (next video) is rejected`() {
        val cands = listOf(c(0, 2700, 2900), c(1, 1500, 1720))
        assertEquals(1, CommentButtonPicker.pick(cands, screenHeight = 2664))
    }

    @Test
    fun `invisible-to-user candidates are rejected even if bounds look on-screen`() {
        val cands = listOf(c(0, 200, 400, visible = false), c(1, 1500, 1720))
        assertEquals(1, CommentButtonPicker.pick(cands, screenHeight = 2664))
    }

    @Test
    fun `no visible candidate returns null`() {
        val cands = listOf(c(0, -633, -414), c(1, 2700, 2900))
        assertNull(CommentButtonPicker.pick(cands, screenHeight = 2664))
    }

    @Test
    fun `multiple visible picks the lowest one on screen`() {
        val cands = listOf(c(0, 300, 500), c(1, 1500, 1720))
        assertEquals(1, CommentButtonPicker.pick(cands, screenHeight = 2664))
    }
}
