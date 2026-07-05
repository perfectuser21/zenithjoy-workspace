package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Sprint 07052218 followup — PR #1124 事后核验发现的功能性缺口：
 * DmOutreachRateLimiter / SnapshotDiscipline 只是孤立工具类，全仓库零调用点，
 * AgentService 完全没有处理 dm_outreach 任务的真实执行路径。
 *
 * 本测试针对 DouyinDmOutreachService 里"该判定为 sent/limited/failed 哪一态"的
 * 纯判定函数（三态判定是 Windows 路径 services/agent/src/publishers/douyin-dm-outreach.cjs
 * 已验证过的标准：气泡/回执出现才算 sent，不可点私信按钮=failed，频控不过=limited，
 * Android 判定真相标准必须与 Windows 一致，不得放宽）。
 *
 * DouyinDmOutreachService 尚未实现（TDD Red）— Generator 需要在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt
 * 新增 `class DouyinDmOutreachService : AccessibilityService()`，companion object 里提供
 * `internal fun classifyOutcome(rateLimited: Boolean, dmEntryFound: Boolean, sendConfirmed: Boolean): Outcome`
 * 和 `internal enum class Outcome { SENT, LIMITED, FAILED }`。
 */
class DouyinDmOutreachServiceOutcomeTest {

    @Test
    fun `rate limited takes priority and yields LIMITED regardless of UI state`() {
        assertEquals(
            DouyinDmOutreachService.Outcome.LIMITED,
            DouyinDmOutreachService.classifyOutcome(rateLimited = true, dmEntryFound = true, sendConfirmed = true),
        )
    }

    @Test
    fun `dm entry not found yields FAILED`() {
        assertEquals(
            DouyinDmOutreachService.Outcome.FAILED,
            DouyinDmOutreachService.classifyOutcome(rateLimited = false, dmEntryFound = false, sendConfirmed = false),
        )
    }

    @Test
    fun `dm entry found but send not confirmed yields FAILED (no false sent)`() {
        assertEquals(
            DouyinDmOutreachService.Outcome.FAILED,
            DouyinDmOutreachService.classifyOutcome(rateLimited = false, dmEntryFound = true, sendConfirmed = false),
        )
    }

    @Test
    fun `not rate limited, entry found, send confirmed yields SENT`() {
        assertEquals(
            DouyinDmOutreachService.Outcome.SENT,
            DouyinDmOutreachService.classifyOutcome(rateLimited = false, dmEntryFound = true, sendConfirmed = true),
        )
    }

    @Test
    fun `outcome maps to lowercase status string matching Windows path vocabulary`() {
        assertEquals("sent", DouyinDmOutreachService.Outcome.SENT.toStatusString())
        assertEquals("limited", DouyinDmOutreachService.Outcome.LIMITED.toStatusString())
        assertEquals("failed", DouyinDmOutreachService.Outcome.FAILED.toStatusString())
    }
}
