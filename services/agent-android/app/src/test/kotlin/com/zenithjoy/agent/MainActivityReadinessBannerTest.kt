package com.zenithjoy.agent

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 客户看的是 App 界面，不是 logcat。两条界面级判据必须机械守住：
 *
 * ① 无障碍横幅此前用 `collectServiceBound()`，只查 3 个服务里的**第 1 个**（采集）。
 *    客户开了采集没开私信 → 横幅显示绿，私信/账号扫描静默全死。必须全查。
 * ② 同族变体包（`.e2e`）出现在客户机上时界面必须给出处置入口，否则客户在系统无障碍列表里
 *    看到两个同名「ZenithJoy Agent」，点错一个就静默失效（0819 小白整晚干不了活的直接原因）。
 *
 * 用源码级断言而不是 UI 测试：MainActivity 是纯代码构建的 View，起 Robolectric 不划算，
 * 而这两条的失效方式都是"某个调用被换回旧的"，源码断言就能卡住。
 */
class MainActivityReadinessBannerTest {

    private fun mainActivitySource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/MainActivity.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt"),
        )
        return (candidates.firstOrNull { it.exists() }
            ?: error("MainActivity.kt not found in ${candidates.map { it.absolutePath }}"))
            .readText()
    }

    @Test
    fun `无障碍横幅必须全查三个服务，不许只查采集那一个`() {
        val source = mainActivitySource()

        assertTrue(
            "横幅必须走 checkSelfAccessibility(全查 3 个服务)",
            source.contains("checkSelfAccessibility"),
        )
        assertFalse(
            "collectServiceBound 只查第 1 个服务，客户开了采集没开私信会误显示为绿——不许再用",
            source.contains("collectServiceBound"),
        )
    }

    @Test
    fun `界面必须有同族变体包冲突的处置入口`() {
        val source = mainActivitySource()

        assertTrue(
            "必须判定同族变体包冲突",
            source.contains("judgeVariantConflict") || source.contains("variantConflict"),
        )
        assertTrue(
            "必须给一键卸载入口（ACTION_DELETE 拉起系统卸载确认框），只提示不给出口等于把活推给客户",
            source.contains("ACTION_DELETE"),
        )
    }

    @Test
    fun `BLOCK 也不许把设备变哑——AgentService 心跳必须照常`() {
        val source = mainActivitySource()

        assertFalse(
            "绝不能因为变体冲突就跳过/停掉 AgentService：设备不心跳=中台彻底看不见它，" +
                "比「能看见但未就绪」更糟",
            Regex("""BLOCK[\s\S]{0,400}?stopService""").containsMatchIn(source),
        )
    }
}
