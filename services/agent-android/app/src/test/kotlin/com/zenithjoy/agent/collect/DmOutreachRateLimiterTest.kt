package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

/**
 * Sprint 07052218 — Android 私信触达频控计数器。
 * PRD NFR：10 分钟窗口内已发 >=3 条则本次不发，等下一个时间窗；窗口外历史不计入。
 * DmOutreachRateLimiter 尚未实现（TDD Red） — Generator 需在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DmOutreachRateLimiter.kt
 * 新增 `object DmOutreachRateLimiter { fun isWithinLimit(sentTimestampsMs: List<Long>, nowMs: Long,
 * windowMs: Long = 600_000L, maxCount: Int = 3): Boolean }`。
 */
class DmOutreachRateLimiterTest {

    @Test
    fun `empty history allows send`() {
        assertTrue(DmOutreachRateLimiter.isWithinLimit(emptyList(), nowMs = 10_000_000L))
    }

    @Test
    fun `2 sends within 10min window still allows send (would be 3rd)`() {
        val now = 10_000_000L
        val history = listOf(now - 60_000L, now - 120_000L) // 1min/2min 前
        assertTrue(DmOutreachRateLimiter.isWithinLimit(history, now))
    }

    @Test
    fun `3 sends within 10min window rejects 4th send`() {
        val now = 10_000_000L
        val history = listOf(now - 60_000L, now - 120_000L, now - 180_000L)
        assertFalse(DmOutreachRateLimiter.isWithinLimit(history, now))
    }

    @Test
    fun `sends outside 10min window are not counted`() {
        val now = 10_000_000L
        // 3 条历史记录都在 11 分钟前 — 超出窗口，不计入
        val history = listOf(now - 660_000L, now - 700_000L, now - 720_000L)
        assertTrue(DmOutreachRateLimiter.isWithinLimit(history, now))
    }

    @Test
    fun `boundary exactly at window edge is still counted (inclusive)`() {
        val now = 10_000_000L
        val windowMs = 600_000L
        // 3 条恰好卡在窗口边界内（now - windowMs），应被计入并拒绝
        val history = listOf(now - windowMs, now - windowMs + 1_000L, now - windowMs + 2_000L)
        assertFalse(DmOutreachRateLimiter.isWithinLimit(history, now, windowMs = windowMs))
    }
}
