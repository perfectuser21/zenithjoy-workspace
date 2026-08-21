package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 等节点期间被厂商插屏抢前台时，必须**主动把它消掉**，而不是干等到超时。
 *
 * 0821 真机现场（装 2.1.33 之后，失败现场第一次落进正表）：
 *   NO_SEARCH_INPUT | 前台=com.hihonor.systemmanager
 *   A3-diag: 搜索入口等待超时 failure=WRONG_FOREGROUND attempts=24
 *
 * 精确缺口：`awaitAppForeground`（前台闸）会主动消插屏，但 `awaitNode`（等节点）
 * **只轮询、不消除**——它顺手记下前台是谁，然后干等满 24 轮 12 秒。
 * 于是荣耀系统管家的广告盖上来时，没有任何人去按掉它。
 *
 * #1687 的"重新拉起再试"把成功率从 0% 提到 60%，但剩下 40% 全卡在这里：
 * 重拉之后广告可能再次盖上，等待期依旧无人处理。加长等待救不了——
 * 前台不是抖音，等到天荒地老也等不出那个节点。
 *
 * 本函数复用已有的 [NodeAwait.decideGateAction]（前台闸用的同一套判定），
 * 只回答一个新问题：**等节点的过程中，该不该顺手消一下前台的插屏。**
 */
class InterloperDismissTest {

    private val SELF = "com.zenithjoy.agent"
    private val TARGET = "com.ss.android.ugc.aweme"

    @Test
    fun `厂商插屏盖在目标之上且有可消除项时应点掉它`() {
        assertEquals(
            GateAction.TAP_DISMISS,
            decideInterloperAction(
                currentPkg = "com.hihonor.systemmanager",
                selfPkg = SELF, targetPkg = TARGET,
                hasDismissTarget = true, blindRounds = 0,
            ),
        )
    }

    @Test
    fun `厂商插屏盖着但找不到可消除项时按返回`() {
        assertEquals(
            GateAction.PRESS_BACK,
            decideInterloperAction(
                currentPkg = "com.hihonor.systemmanager",
                selfPkg = SELF, targetPkg = TARGET,
                hasDismissTarget = false, blindRounds = 0,
            ),
        )
    }

    @Test
    fun `前台已经是目标 App 时绝不动作——绝不在抖音内部误按返回`() {
        assertEquals(
            GateAction.DONE,
            decideInterloperAction(
                currentPkg = TARGET, selfPkg = SELF, targetPkg = TARGET,
                hasDismissTarget = true, blindRounds = 0,
            ),
        )
    }

    @Test
    fun `前台是自己的界面时只等待，不按返回`() {
        assertEquals(
            GateAction.WAIT,
            decideInterloperAction(
                currentPkg = SELF, selfPkg = SELF, targetPkg = TARGET,
                hasDismissTarget = false, blindRounds = 0,
            ),
        )
    }

    @Test
    fun `不带期望包名时一律不动作——老调用点行为必须一字不变`() {
        assertEquals(
            GateAction.WAIT,
            decideInterloperAction(
                currentPkg = "com.hihonor.systemmanager",
                selfPkg = SELF, targetPkg = null,
                hasDismissTarget = true, blindRounds = 0,
            ),
        )
    }

    @Test
    fun `消除动作必须有次数上限，防止和插屏无限对拉耗光单条 lead 的 90 秒熔断`() {
        assertTrue(
            "上限必须是正数且不能大到吃满整轮等待",
            InterloperDismiss.MAX_DISMISS_PER_WAIT in 1..4,
        )
    }
}
