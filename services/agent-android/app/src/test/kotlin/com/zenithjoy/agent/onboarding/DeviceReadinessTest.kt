package com.zenithjoy.agent.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 设备端把已有的几项就绪判据汇成一份 readiness，随心跳上报，让客服在中台看得见
 * 「这台客户手机卡在哪一项」。
 *
 * 判据必须用不会撒谎的那个（铁律 2dc450f7 / 决策 44cb3e8e）：无障碍走
 * `checkSelfAccessibility`（真 Bound + 本进程包名），不读 Secure Settings 字符串。
 * 上报假绿比不上报更糟——中台以为就绪、任务照派、静默失败，正是要根治的问题。
 */
class DeviceReadinessTest {

    private val prodPkg = "com.zenithjoy.agent"
    private val e2ePkg = "com.zenithjoy.agent.e2e"
    private val collectCls = "com.zenithjoy.agent.collect.DouyinCollectService"

    private val allBound = AccessibilitySelfCheck(missing = emptyList(), foreignHolders = emptyMap())
    private val noVariant = VariantConflict(VariantVerdict.OK, emptyList(), emptyMap())

    private fun build(
        accessibility: AccessibilitySelfCheck = allBound,
        variant: VariantConflict = noVariant,
        screenCapture: Boolean = true,
        audio: Boolean = true,
    ) = buildDeviceReadiness(accessibility, variant, screenCapture, audio)

    @Test
    fun `四项全好——每一项都 ok，没有 detail 噪音`() {
        val r = build()

        assertEquals(
            setOf(READINESS_ACCESSIBILITY, READINESS_VARIANT_CONFLICT, READINESS_SCREEN_CAPTURE, READINESS_AUDIO_RECORD),
            r.keys,
        )
        assertTrue("全好时不该有任何 ok=false", r.values.all { it.ok })
        assertTrue("全好时不该塞 detail", r.values.all { it.detail == null })
    }

    @Test
    fun `无障碍没绑全——ok=false 且 detail 说清楚缺哪个`() {
        val check = AccessibilitySelfCheck(missing = listOf(collectCls), foreignHolders = emptyMap())

        val item = build(accessibility = check)[READINESS_ACCESSIBILITY]!!

        assertFalse(item.ok)
        assertNotNull("未就绪必须带 detail，否则客服看到一个红点也不知道要客户干什么", item.detail)
        assertTrue(item.detail!!.contains("DouyinCollectService"))
    }

    // 小白场景：授权被 .e2e 变体包拿走
    @Test
    fun `授权被同族变体包拿走——detail 必须点名劫持方，客服才能一句话指导客户`() {
        val check = AccessibilitySelfCheck(
            missing = listOf(collectCls),
            foreignHolders = mapOf(collectCls to listOf(e2ePkg)),
        )

        val item = build(accessibility = check)[READINESS_ACCESSIBILITY]!!

        assertFalse(item.ok)
        assertTrue("detail 必须含劫持方包名", item.detail!!.contains(e2ePkg))
    }

    @Test
    fun `变体包冲突 BLOCK——单独一项报红，不和无障碍混成一项`() {
        val conflict = VariantConflict(
            VariantVerdict.BLOCK, listOf(e2ePkg), mapOf(collectCls to listOf(e2ePkg)),
        )

        val r = build(variant = conflict)

        assertFalse(r[READINESS_VARIANT_CONFLICT]!!.ok)
        assertTrue(r[READINESS_VARIANT_CONFLICT]!!.detail!!.contains(e2ePkg))
    }

    @Test
    fun `变体包只是 WARN——不算未就绪，但 detail 留痕（小黄场景照样能干活）`() {
        val conflict = VariantConflict(VariantVerdict.WARN, listOf(e2ePkg), emptyMap())

        val item = build(variant = conflict)[READINESS_VARIANT_CONFLICT]!!

        assertTrue("WARN 不阻断，ok 必须是 true，否则会把小黄那种机器判死", item.ok)
        assertNotNull("但要留 detail，让客服知道这台机器有隐患", item.detail)
    }

    @Test
    fun `截图未授权 与 录音未授权 各自独立报红`() {
        val r = build(screenCapture = false, audio = false)

        assertFalse(r[READINESS_SCREEN_CAPTURE]!!.ok)
        assertFalse(r[READINESS_AUDIO_RECORD]!!.ok)
        assertNotNull(r[READINESS_SCREEN_CAPTURE]!!.detail)
        assertNotNull(r[READINESS_AUDIO_RECORD]!!.detail)
        assertTrue("这两项坏不该连累无障碍那一项", r[READINESS_ACCESSIBILITY]!!.ok)
    }

    @Test
    fun `就绪度不许自己算总账——总判定由服务端合成（它还知道 license 绑没绑上）`() {
        val r: Map<String, ReadinessItem> = build()

        assertNull(
            "设备端不该产出 all_ok/verdict 之类的总判定：小白正在发生的 license 配额被拒" +
                "设备端根本不知道，自己算总账必然算错",
            r["verdict"] ?: r["all_ok"],
        )
    }
}
