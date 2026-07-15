package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Seg3 方案 B′ 收口 —— dm_outreach 派单 payload 的【搜索目标】必须取 douyin_id（TDD Red 先行）。
 *
 * 断链现场：服务端 acquisition-dispatch.ts 已经改成 payload 同时带
 *   profile_url（真 URL，给 Windows 的 douyin-dm-outreach.cjs `page.goto`）
 *   douyin_id  （裸抖音号，给 Android）
 * 但 AgentService.routeDmOutreachTask 仍在读 payload["profile_url"] 并把它交给
 * DouyinDmOutreachService.startOutreach()，后者 :151-153 `val targetDouyinId = profileUrl`
 * 把它【当抖音号搜】→ 拿 URL 去搜必然 NO_MATCH。
 *
 * 也就是说：只改服务端不改这里，douyin_id 会被完全忽略，链路照样断。
 * 本函数把"该拿哪个字段当搜索目标"固化成可测判定。
 */
class AgentServiceDmTargetTest {

    @Test
    fun `取 douyin_id 当搜索目标，不取 profile_url`() {
        val payload = mapOf(
            "profile_url" to "https://www.douyin.com/user/MS4wLjABAAAA",
            "douyin_id" to "1689210742",
        )
        assertEquals("1689210742", AgentService.extractDmTargetDouyinId(payload))
    }

    @Test
    fun `没有 douyin_id 时返回 null —— 绝不回退成 profile_url`() {
        // 回退 = 把 URL 当抖音号搜 = 必然 NO_MATCH，还会烧掉一次频控额度、
        // 在 dm_outreach_log 里留下一条"派了但没送达"的假象，掩盖"根本没读到号"的真问题。
        // 宁可不派（#1306 宁可空，不可猜）。
        val payload = mapOf("profile_url" to "https://www.douyin.com/user/MS4wLjABAAAA")
        assertNull(AgentService.extractDmTargetDouyinId(payload))
    }

    @Test
    fun `douyin_id 空白 → null`() {
        val payload = mapOf("profile_url" to "https://x", "douyin_id" to "   ")
        assertNull(AgentService.extractDmTargetDouyinId(payload))
    }

    @Test
    fun `douyin_id 非字符串（脏 payload）→ null，不炸`() {
        val payload = mapOf("douyin_id" to 12345)
        assertNull(AgentService.extractDmTargetDouyinId(payload))
    }

    @Test
    fun `拿到的目标绝不能是 URL 形状`() {
        // 守死"退化回老 bug"：万一有人把 douyin_id 又接回 profile_url，这条会红。
        val payload = mapOf(
            "profile_url" to "https://www.douyin.com/user/MS4wLjABAAAA",
            "douyin_id" to "1689210742",
        )
        val target = AgentService.extractDmTargetDouyinId(payload)
        assertEquals(false, target!!.startsWith("http"))
    }
}
