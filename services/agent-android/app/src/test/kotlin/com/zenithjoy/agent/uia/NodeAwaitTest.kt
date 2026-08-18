package com.zenithjoy.agent.uia

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeAwaitTest {

    /** 测试替身：按脚本逐次返回快照，并记录 sleep 被调用了几次。 */
    private class Fixture(private val script: List<ProbeSnapshot<String>>) {
        var sleepCalls = 0
            private set
        private var index = 0
        val sleep: suspend (Long) -> Unit = { sleepCalls++ }
        val probe: () -> ProbeSnapshot<String> = {
            val snap = script[index.coerceAtMost(script.lastIndex)]
            index++
            snap
        }
    }

    private fun absent(pkg: String? = "com.ss.android.ugc.aweme") =
        ProbeSnapshot<String>(target = null, rootPresent = true, foregroundPkg = pkg)

    private fun present(pkg: String? = "com.ss.android.ugc.aweme") =
        ProbeSnapshot(target = "HIT", rootPresent = true, foregroundPkg = pkg)

    private fun noRoot() =
        ProbeSnapshot<String>(target = null, rootPresent = false, foregroundPkg = null)

    // 1. 前 3 次无目标、第 4 次出现 → 命中且不早退不多轮
    @Test
    fun `hits on fourth attempt without exiting early`() = runTest {
        val f = Fixture(listOf(absent(), absent(), absent(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals("HIT", outcome.value)
        assertEquals(4, outcome.attempts)
    }

    // 2. 始终不出现 → null 且用满 attempts
    @Test
    fun `exhausts attempts when target never appears`() = runTest {
        val f = Fixture(listOf(absent()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 6, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertFalse(outcome.hit)
        assertNull(outcome.value)
        assertEquals(6, outcome.attempts)
    }

    // 3. 首次即命中 → attempts=1 且 sleep 零调用（热路径零延迟）
    @Test
    fun `hot path does not sleep when target present immediately`() = runTest {
        val f = Fixture(listOf(present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 24, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals(1, outcome.attempts)
        assertEquals(0, f.sleepCalls)
    }

    // 4. 中途拿不到 root → 不崩、继续轮询、everSawRoot 反映曾见过
    @Test
    fun `keeps polling when root momentarily absent`() = runTest {
        val f = Fixture(listOf(noRoot(), noRoot(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals(3, outcome.attempts)
        assertTrue(outcome.everSawRoot)
    }

    // 5. 全程无 root → NO_ROOT
    @Test
    fun `classifies as NO_ROOT when root never available`() = runTest {
        val f = Fixture(listOf(noRoot()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertFalse(outcome.everSawRoot)
        assertEquals(
            WaitFailure.NO_ROOT,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 6. 有 root 但前台一直是别的包 → WRONG_FOREGROUND，且记下该包名
    @Test
    fun `classifies as WRONG_FOREGROUND when another app holds foreground`() = runTest {
        val f = Fixture(listOf(absent(pkg = "com.hihonor.systemmanager")))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals("com.hihonor.systemmanager", outcome.lastForegroundPkg)
        assertEquals(
            WaitFailure.WRONG_FOREGROUND,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 7. 前台是期望包但目标始终不出现 → TARGET_ABSENT
    @Test
    fun `classifies as TARGET_ABSENT when expected app shown but node missing`() = runTest {
        val f = Fixture(listOf(absent()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals(
            WaitFailure.TARGET_ABSENT,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 9. 耗尽 attempts 时只在探测之间睡，最后一次探测后不再多睡
    //    （proven-to-fire 发现 #3 守不住 `if (attempts < maxAttempts)`：命中时 return 已经
    //     跳过了 sleep，删掉那个守卫 #3 照样绿。真正能守住它的是本条。）
    @Test
    fun `does not sleep after the final attempt`() = runTest {
        val f = Fixture(listOf(absent()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 5, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals(5, outcome.attempts)
        assertEquals(4, f.sleepCalls)
    }

    // ── pickDismissLabel：厂商插屏该点哪个按钮 ────────────────────────────────
    // 真机(荣耀 X30/MagicOS)实测：冷启动抖音时 com.hihonor.systemmanager 的
    // AppSplashAdvertiseActivity 会盖在抖音之上，前台包名不是抖音，光等节点等不出来。

    @Test
    fun `auto jump dialog picks 允许 rather than generic dismiss`() {
        val texts = listOf("ZenithJoyAgent 想要打开 抖音", "是否允许", "取消", "允许")
        assertEquals("允许", NodeAwait.pickDismissLabel(texts))
    }

    @Test
    fun `vendor splash ad picks 跳过`() {
        val texts = listOf("广告", "跳过", "了解详情")
        assertEquals("跳过", NodeAwait.pickDismissLabel(texts))
    }

    @Test
    fun `dismiss labels follow priority order`() {
        // 同时出现「关闭」和「我知道了」时取更靠前的「关闭」
        assertEquals("关闭", NodeAwait.pickDismissLabel(listOf("我知道了", "关闭")))
    }

    @Test
    fun `returns null when nothing dismissable`() {
        assertNull(NodeAwait.pickDismissLabel(listOf("首页", "朋友", "消息")))
    }

    @Test
    fun `允许 only counts inside auto jump dialog`() {
        // 没有「想要打开/是否允许」上下文时，不能见到「允许」就点——可能是别的应用的权限框
        assertNull(NodeAwait.pickDismissLabel(listOf("允许", "位置权限")))
    }

    // 8. waitedMs 是间隔数×interval，不是次数×interval
    @Test
    fun `waitedMs counts intervals not attempts`() = runTest {
        val f = Fixture(listOf(absent(), absent(), absent(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals(4, outcome.attempts)
        assertEquals(1500L, outcome.waitedMs(500))
    }
}
