package com.zenithjoy.agent.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机确诊(2026-08-19 → 08-20 对照实验)：设备上同时装着两个同族变体包
 * `com.zenithjoy.agent`(prod) 与 `com.zenithjoy.agent.e2e`(开发变体)。
 * 它们在系统里是**两个独立 App，无障碍授权互不相通**，但名字都叫「ZenithJoy Agent」。
 *
 * | 机器 | 无障碍授权归属 | 能否干活 |
 * |---|---|---|
 * | 小黄 MAA-AN00 | com.zenithjoy.agent × 3（prod） | ✅ |
 * | 小白 RMX3478 | com.zenithjoy.agent.e2e × 3（变体） | ❌ 派发广播进虚空 |
 *
 * 唯一变量就是授权点在哪个包上，**与手机品牌无关**。BYOD 客户场景下这是 100% 可根除的
 * 自造坑：开发变体本就不该出现在客户机上。
 *
 * 分级是硬要求：小黄同样双包并存却工作正常，一刀切硬拦截会把产出最好的机器当场拦停。
 */
class VariantConflictGuardTest {

    private val prodPkg = "com.zenithjoy.agent"
    private val e2ePkg = "com.zenithjoy.agent.e2e"

    private val collectCls = "com.zenithjoy.agent.collect.DouyinCollectService"
    private val outreachCls = "com.zenithjoy.agent.collect.DouyinDmOutreachService"
    private val scanCls = "com.zenithjoy.agent.account.DeviceAccountScanService"
    private val required = listOf(collectCls, outreachCls, scanCls)

    private fun allBound() = AccessibilitySelfCheck(missing = emptyList(), foreignHolders = emptyMap())

    // ── 同族包名推导 ──────────────────────────────────────────

    @Test
    fun `prod 包能推出 e2e 变体`() {
        assertEquals(listOf(e2ePkg), siblingVariantPackages(prodPkg))
    }

    @Test
    fun `e2e 变体能反推出 prod 包`() {
        assertEquals(listOf(prodPkg), siblingVariantPackages(e2ePkg))
    }

    @Test
    fun `推导结果绝不包含自己——否则会把自己当成冲突方`() {
        assertFalse(siblingVariantPackages(prodPkg).contains(prodPkg))
        assertFalse(siblingVariantPackages(e2ePkg).contains(e2ePkg))
    }

    @Test
    fun `推导结果无重复`() {
        val r = siblingVariantPackages(prodPkg)
        assertEquals(r.size, r.distinct().size)
    }

    // ── 分级判定 ──────────────────────────────────────────────

    @Test
    fun `没有同族包——OK，不打扰`() {
        val c = judgeVariantConflict(installedSiblings = emptyList(), selfCheck = allBound())

        assertEquals(VariantVerdict.OK, c.verdict)
        assertTrue(c.siblingPackages.isEmpty())
        assertTrue(c.hijackedServices.isEmpty())
    }

    // ── 核心 1/2：小黄场景 —— 双包并存但本包全绑上，绝不能阻断 ──
    @Test
    fun `小黄场景 双包并存但本包三服务全绑——WARN 不阻断`() {
        val c = judgeVariantConflict(installedSiblings = listOf(e2ePkg), selfCheck = allBound())

        assertEquals(
            "小黄同样双包并存却工作正常，判 BLOCK 会把产出最好的机器当场拦停",
            VariantVerdict.WARN, c.verdict,
        )
        assertEquals(listOf(e2ePkg), c.siblingPackages)
    }

    // ── 核心 2/2：小白场景 —— 服务被同族包劫走，必须硬拦截并点名 ──
    @Test
    fun `小白场景 三服务全被 e2e 变体持有——BLOCK 且点名劫持方`() {
        val selfCheck = AccessibilitySelfCheck(
            missing = required,
            foreignHolders = mapOf(collectCls to listOf(e2ePkg), outreachCls to listOf(e2ePkg), scanCls to listOf(e2ePkg)),
        )

        val c = judgeVariantConflict(installedSiblings = listOf(e2ePkg), selfCheck = selfCheck)

        assertEquals(VariantVerdict.BLOCK, c.verdict)
        assertEquals(
            "必须点名是哪个包劫走了哪些服务，否则客户和客服都无从下手",
            mapOf(collectCls to listOf(e2ePkg), outreachCls to listOf(e2ePkg), scanCls to listOf(e2ePkg)),
            c.hijackedServices,
        )
        assertTrue("诊断文案必须带上劫持方包名", c.describe().contains(e2ePkg))
    }

    @Test
    fun `只有一个服务被劫走——同样 BLOCK，半残比全死更隐蔽`() {
        val selfCheck = AccessibilitySelfCheck(
            missing = listOf(outreachCls),
            foreignHolders = mapOf(outreachCls to listOf(e2ePkg)),
        )

        val c = judgeVariantConflict(installedSiblings = listOf(e2ePkg), selfCheck = selfCheck)

        assertEquals(VariantVerdict.BLOCK, c.verdict)
        assertEquals(mapOf(outreachCls to listOf(e2ePkg)), c.hijackedServices)
    }

    @Test
    fun `有同族包但缺的服务并非被它持有——WARN，缺服务归无障碍横幅管不重复报`() {
        val selfCheck = AccessibilitySelfCheck(missing = required, foreignHolders = emptyMap())

        val c = judgeVariantConflict(installedSiblings = listOf(e2ePkg), selfCheck = selfCheck)

        assertEquals(VariantVerdict.WARN, c.verdict)
        assertTrue(c.hijackedServices.isEmpty())
    }

    @Test
    fun `第三方 app 持有同名服务但它不是同族包——不算劫持，不许误伤`() {
        val selfCheck = AccessibilitySelfCheck(
            missing = listOf(collectCls),
            foreignHolders = mapOf(collectCls to listOf("com.some.other.app")),
        )

        val c = judgeVariantConflict(installedSiblings = listOf(e2ePkg), selfCheck = selfCheck)

        assertEquals(VariantVerdict.WARN, c.verdict)
        assertTrue(c.hijackedServices.isEmpty())
    }

    @Test
    fun `OK 与 WARN 都不阻断，只有 BLOCK 阻断`() {
        assertFalse(VariantVerdict.OK.blocksUsage())
        assertFalse(VariantVerdict.WARN.blocksUsage())
        assertTrue(VariantVerdict.BLOCK.blocksUsage())
    }
}
