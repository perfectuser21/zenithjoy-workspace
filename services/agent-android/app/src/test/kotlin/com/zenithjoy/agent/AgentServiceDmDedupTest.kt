package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Seg4 私信"幽灵派单吃频控"根因（真机复现 2026-07-17 xian-rog）：
 *
 * dm-outreach-result 回执上报若迟迟没被确认（如 Bug1 的连接池超时），服务端任务永远停在
 * queued，心跳循环每 ~30s 就把【同一个】task_id 当"待处理任务"原样重新投递一次。
 * routeDmOutreachTask 对每次投递都重新走 DmOutreachRateLimiter 判定并
 * `dmSentTimestamps.add(now)`——同一条卡死任务被重投递 3 次，就能把 10 分钟频控窗口的
 * 3 个名额全部占满，连累完全无关的新任务被误判 rate-limited（明明账号啥也没真发）。
 *
 * 本函数把"这个 task_id 本次心跳周期内是否已经处理过"固化成可测判定：已见过的 task_id
 * 直接跳过，不再消耗频控名额，也不再重复触发无障碍执行。
 */
class AgentServiceDmDedupTest {

    @Test
    fun `未见过的 task_id 不算重复`() {
        val seen = mutableSetOf("task-A")
        assertFalse(AgentService.shouldSkipDuplicateDmTask("task-B", seen))
    }

    @Test
    fun `已见过的 task_id 判定为重复——不能再计频控`() {
        val seen = mutableSetOf("task-A")
        assertTrue(AgentService.shouldSkipDuplicateDmTask("task-A", seen))
    }

    @Test
    fun `空集合下任何 task_id 都不算重复（第一次投递必须放行）`() {
        assertFalse(AgentService.shouldSkipDuplicateDmTask("task-A", mutableSetOf()))
    }
}
