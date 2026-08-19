package com.zenithjoy.agent.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机确诊(2026-08-19 小白 realme RMX3478)：设备上同时装着两个变体包——
 * `com.zenithjoy.agent`(prod 2.1.28，真正在跑、在拉任务、在心跳) 与
 * `com.zenithjoy.agent.e2e`(2.1.24-e2e)。三个无障碍服务的授权**全部落在 .e2e 包上**：
 *
 *   Enabled services:{ com.zenithjoy.agent.e2e/com.zenithjoy.agent.collect.DouyinCollectService,
 *                      com.zenithjoy.agent.e2e/com.zenithjoy.agent.collect.DouyinDmOutreachService,
 *                      com.zenithjoy.agent.e2e/com.zenithjoy.agent.account.DeviceAccountScanService }
 *
 * prod 包一条都没有 → 采集任务的派发广播进虚空、永不 ack、任务静默失败。
 *
 * 而旧自检看的是 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 字符串里有没有
 * "DouyinCollectService"——字符串里确实有，只是包名前缀是 .e2e。**双重撒谎**：
 * ① 不看包名（别人家的服务算成自己的）② 不看 Bound（Enabled≠Bound，ColorOS 尤甚）。
 *
 * 正确判据只有一个：`AccessibilityManager.getEnabledAccessibilityServiceList()` 返回的
 * 是系统**真正绑定**的服务，取其 ServiceInfo 的 packageName/name，和**本进程自己的**
 * packageName 严格比对。本测试锁死这个判据。
 */
class SelfPackageAccessibilityTest {

    private val prodPkg = "com.zenithjoy.agent"
    private val e2ePkg = "com.zenithjoy.agent.e2e"

    private val collectCls = "com.zenithjoy.agent.collect.DouyinCollectService"
    private val outreachCls = "com.zenithjoy.agent.collect.DouyinDmOutreachService"
    private val scanCls = "com.zenithjoy.agent.account.DeviceAccountScanService"
    private val required = listOf(collectCls, outreachCls, scanCls)

    private fun boundUnder(pkg: String) = required.map { BoundAccessibilityService(pkg, it) }

    @Test
    fun `三个服务都绑在本包名下——无缺失、无外包持有`() {
        val result = checkSelfAccessibility(boundUnder(prodPkg), prodPkg, required)

        assertTrue("本包全绑上时不该报缺失", result.missing.isEmpty())
        assertTrue("本包全绑上时不该报外包持有", result.foreignHolders.isEmpty())
        assertTrue(result.allBound)
    }

    // ── 小白现场的精确复现：权限全在 .e2e 包，干活的是 prod 包 ──
    @Test
    fun `授权落在 e2e 变体包上——prod 包必须判全部缺失，并点名是谁拿走了`() {
        val result = checkSelfAccessibility(boundUnder(e2ePkg), prodPkg, required)

        assertEquals("prod 包一条都没绑上，必须全部报缺失", required, result.missing)
        assertEquals(
            "必须点名是 .e2e 包拿走了这三个服务，否则排查还得再花一天",
            mapOf(
                collectCls to listOf(e2ePkg),
                outreachCls to listOf(e2ePkg),
                scanCls to listOf(e2ePkg),
            ),
            result.foreignHolders,
        )
        assertTrue(!result.allBound)
    }

    // ── 反向：e2e 包在跑时，看到 prod 包的授权同样不能算自己的 ──
    @Test
    fun `e2e 包在跑而授权在 prod 包上——同样判缺失，不许把别人的算成自己的`() {
        val result = checkSelfAccessibility(boundUnder(prodPkg), e2ePkg, required)

        assertEquals(required, result.missing)
        assertEquals(mapOf(collectCls to listOf(prodPkg), outreachCls to listOf(prodPkg), scanCls to listOf(prodPkg)), result.foreignHolders)
    }

    @Test
    fun `包名前缀相同不等于同一个包——com_zenithjoy_agent 不匹配 com_zenithjoy_agent_e2e`() {
        val result = checkSelfAccessibility(
            listOf(BoundAccessibilityService(e2ePkg, collectCls)),
            prodPkg,
            listOf(collectCls),
        )
        assertEquals(listOf(collectCls), result.missing)
    }

    @Test
    fun `系统一条无障碍都没绑——全部缺失且无外包持有`() {
        val result = checkSelfAccessibility(emptyList(), prodPkg, required)

        assertEquals(required, result.missing)
        assertTrue("没有任何服务被绑时不该编造外包持有者", result.foreignHolders.isEmpty())
    }

    @Test
    fun `别家 app 的无障碍服务不产生噪音`() {
        val bound = boundUnder(prodPkg) + BoundAccessibilityService(
            "com.google.android.marvin.talkback",
            "com.google.android.accessibility.selecttospeak.SelectToSpeakService",
        )
        val result = checkSelfAccessibility(bound, prodPkg, required)

        assertTrue(result.missing.isEmpty())
        assertTrue("talkback 跟我们的服务类名无关，不该进 foreignHolders", result.foreignHolders.isEmpty())
    }

    @Test
    fun `只缺采集服务——只报这一个，且不误伤另外两个`() {
        val bound = listOf(
            BoundAccessibilityService(prodPkg, outreachCls),
            BoundAccessibilityService(prodPkg, scanCls),
        )
        val result = checkSelfAccessibility(bound, prodPkg, required)

        assertEquals(listOf(collectCls), result.missing)
    }
}
