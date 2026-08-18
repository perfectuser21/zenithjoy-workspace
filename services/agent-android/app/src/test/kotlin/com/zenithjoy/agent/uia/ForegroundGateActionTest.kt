package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 前台闸每一轮该干什么——纯决策函数。
 *
 * 真机复现（2026-08-18，小黄 MAA-AN00）：前台闸看到前台不是抖音就按返回，把**自家正在转发的
 * trampoline Activity** 一路退到桌面，抖音永远起不来：
 * ```
 * 15:43:46.086 trampoline START（自家 Activity，正要拉抖音）
 * 15:43:46.156 前台=com.zenithjoy.agent.e2e 无可消除项，按返回   ← 自伤
 * 15:43:47.850 前台=com.hihonor.android.launcher 按返回          ← 一路退到桌面
 * ```
 * 小粉那次「成功」只是因为恰好弹了厂商授权框（前台是 systemmanager），掩盖了这个缺陷。
 */
class ForegroundGateActionTest {

    private val TARGET = "com.ss.android.ugc.aweme"
    private val SELF = "com.zenithjoy.agent.e2e"

    @Test
    fun `target in foreground means done`() {
        assertEquals(
            GateAction.DONE,
            NodeAwait.decideGateAction(TARGET, SELF, TARGET, hasDismissTarget = false, blindRounds = 0),
        )
    }

    @Test
    fun `dismissable popup is tapped even when foreground is self`() {
        // 自家包前台但有可消除项（例如自家页面上盖着系统框）→ 仍然点掉
        assertEquals(
            GateAction.TAP_DISMISS,
            NodeAwait.decideGateAction(SELF, SELF, TARGET, hasDismissTarget = true, blindRounds = 0),
        )
    }

    @Test
    fun `never press back on our own activity`() {
        // trampoline 正在把目标 App 拉起来，按返回会把它干掉——这正是真机踩到的自伤
        assertEquals(
            GateAction.WAIT,
            NodeAwait.decideGateAction(SELF, SELF, TARGET, hasDismissTarget = false, blindRounds = 0),
        )
    }

    @Test
    fun `never press back on launcher`() {
        // 桌面按返回毫无意义（退不出桌面），只会白白消耗轮次
        assertEquals(
            GateAction.WAIT,
            NodeAwait.decideGateAction("com.hihonor.android.launcher", SELF, TARGET, false, 0),
        )
        assertEquals(
            GateAction.WAIT,
            NodeAwait.decideGateAction("com.miui.home", SELF, TARGET, false, 0),
        )
    }

    @Test
    fun `third party app without dismissable item gets back`() {
        assertEquals(
            GateAction.PRESS_BACK,
            NodeAwait.decideGateAction("com.hihonor.systemmanager", SELF, TARGET, false, 0),
        )
    }

    @Test
    fun `no window waits until blind rounds exhausted then backs`() {
        assertEquals(GateAction.WAIT, NodeAwait.decideGateAction(null, SELF, TARGET, false, 0))
        assertEquals(GateAction.WAIT, NodeAwait.decideGateAction(null, SELF, TARGET, false, 3))
        assertEquals(GateAction.PRESS_BACK, NodeAwait.decideGateAction(null, SELF, TARGET, false, 4))
    }
}
