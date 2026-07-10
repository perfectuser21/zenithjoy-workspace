package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

class DouyinCollectServiceStateTest {

    // ── isResultEventDebounced ──────────────────────────────────────────────

    @Test
    fun `debounced when event arrives within settle window`() {
        val triggeredAt = 1_000L
        val now = 1_200L // 200ms 后，settle window 400ms 内
        assertTrue(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    @Test
    fun `not debounced when event arrives after settle window`() {
        val triggeredAt = 1_000L
        val now = 1_500L // 500ms 后，超过 400ms settle window
        assertFalse(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    @Test
    fun `boundary at exactly settle window is still debounced`() {
        val triggeredAt = 1_000L
        val now = 1_400L // 正好 400ms
        assertTrue(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    // ── shouldEnterSubmitting ───────────────────────────────────────────────

    @Test
    fun `allows entering submitting only from TYPING_KEYWORD`() {
        assertTrue(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.TYPING_KEYWORD)
        )
    }

    @Test
    fun `rejects entering submitting from any other state`() {
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.WAITING_SEARCH_RESULTS)
        )
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.SUBMITTING_SEARCH)
        )
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.IDLE)
        )
    }

    // ── shouldRetryWithTabSwitch ─────────────────────────────────────────────
    // 真机复现(2026-07-10)：抖音搜索默认落在"主页"标签（空，找账号用），视频内容在
    // "综合"/"视频"标签。第一次搜索结果超时应该先切标签重试一次，不能直接判失败。

    @Test
    fun `retries with tab switch on first timeout`() {
        assertTrue(DouyinCollectService.shouldRetryWithTabSwitch(alreadyTriedTabSwitch = false))
    }

    @Test
    fun `does not retry again after tab switch already tried once`() {
        assertFalse(DouyinCollectService.shouldRetryWithTabSwitch(alreadyTriedTabSwitch = true))
    }

    // ── shouldSendFallbackBroadcast ──────────────────────────────────────────
    // 队列状态机（CollectTaskQueue）对同一结果不幂等：回调+广播双投递会让
    // AgentService.reportCollectResult 把下一个在跑的 job 提前 markCurrentDone，
    // 重新引入 busy 静默丢任务。回调已注册时禁止再发兜底广播。

    @Test
    fun `does not send fallback broadcast when callback is registered`() {
        assertFalse(DouyinCollectService.shouldSendFallbackBroadcast(callbackRegistered = true))
    }

    @Test
    fun `sends fallback broadcast only when no callback registered`() {
        assertTrue(DouyinCollectService.shouldSendFallbackBroadcast(callbackRegistered = false))
    }
}
