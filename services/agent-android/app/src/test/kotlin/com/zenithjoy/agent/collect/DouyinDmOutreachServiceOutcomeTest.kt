package com.zenithjoy.agent.collect

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    // ── dmOutreachLaunchFlags ────────────────────────────────────────────────
    // 真机复现(2026-07-17 xian-rog)：上一次 dm_outreach 任务发送后设备停留在与 Zenithjoyai
    // 的私信会话页；下一次任务 launchDouyinApp 仅用 NEW_TASK 会 resume 到该遗留会话页而非
    // 首页，导致 locateProfileBySearch 的 findNodeByContentDesc(root,"搜索") 命中了会话内
    // 搜索图标而非首页全局搜索入口，把目标抖音号打进消息搜索框，最终 NO_MATCH。
    // DouyinCollectService 的 Stage1 采集链路已用同款 CLEAR_TASK 修过同类根因
    // （stage1LaunchFlags，见 DouyinCollectServiceStateTest 2026-07-11 真机复现记录）——
    // dm_outreach 执行路径必须叠加同一 flag，否则换台机器/换个任务必复发。

    @Test
    fun `dm outreach launch flags must include CLEAR_TASK to escape stale conversation screen`() {
        val flags = DouyinDmOutreachService.dmOutreachLaunchFlags(base = 0)
        assertTrue(
            "dm_outreach 启动必须带 CLEAR_TASK 清空残留会话页栈，否则 resume 到会话页 → 会话内搜索代替全局搜索 → NO_MATCH",
            (flags and Intent.FLAG_ACTIVITY_CLEAR_TASK) != 0
        )
    }

    @Test
    fun `dm outreach launch flags must include NEW_TASK`() {
        // CLEAR_TASK 必须与 NEW_TASK 同用才生效（Android 契约，同 stage1LaunchFlags）。
        val flags = DouyinDmOutreachService.dmOutreachLaunchFlags(base = 0)
        assertTrue((flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
    }

    @Test
    fun `dm outreach launch flags preserve existing base flags`() {
        val base = 0x00100000 // 任意已有 flag 位
        val flags = DouyinDmOutreachService.dmOutreachLaunchFlags(base = base)
        assertTrue((flags and base) == base)
    }
}
