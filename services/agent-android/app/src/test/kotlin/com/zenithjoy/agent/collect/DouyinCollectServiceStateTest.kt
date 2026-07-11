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

    // ── isBusyStateStale ─────────────────────────────────────────────────────
    // 真机复现(2026-07-10)：state 卡在非 IDLE 且没有任何看门狗覆盖时（例如
    // COLLECTING_VIDEO_CARDS 协程死亡），busy-guard 会永远拒绝新任务。
    // state 停留超过阈值 = 流程已死，busy-guard 应强制复位接受新任务而不是拒绝。

    @Test
    fun `state stuck longer than threshold is stale`() {
        assertTrue(
            DouyinCollectService.isBusyStateStale(stateChangedAtMs = 1_000L, nowMs = 181_001L, thresholdMs = 180_000L)
        )
    }

    @Test
    fun `fresh state within threshold is not stale`() {
        assertFalse(
            DouyinCollectService.isBusyStateStale(stateChangedAtMs = 1_000L, nowMs = 91_000L, thresholdMs = 180_000L)
        )
    }

    @Test
    fun `state at exactly threshold is not stale`() {
        assertFalse(
            DouyinCollectService.isBusyStateStale(stateChangedAtMs = 1_000L, nowMs = 181_000L, thresholdMs = 180_000L)
        )
    }

    // ── mustGestureTap ──────────────────────────────────────────────────────
    // 真机复现(Douyin 39.5.0)：搜索入口 "搜索" TextView(id 混淆为 4ty)整条无障碍祖先链
    // clickable 全为 false。Android performAction(ACTION_CLICK) 不冒泡到祖先，对这种节点
    // 是空操作——openSearchBar 点不动搜索按钮，页面不跳转搜索页，typeKeyword 找不到 EditText
    // 报 NO_SEARCH_INPUT。此纯函数判定：链上无任何可点击节点时必须退回坐标手势点击。

    @Test
    fun `all-false clickable chain must gesture tap (真机 bug 场景)`() {
        // index 0 = 节点自身，到根全 false（正是 Douyin 搜索 TextView 的真机链）
        assertTrue(
            DouyinCollectService.mustGestureTap(listOf(false, false, false, false, false, false))
        )
    }

    @Test
    fun `node itself clickable does not need gesture tap`() {
        assertFalse(
            DouyinCollectService.mustGestureTap(listOf(true, false, false))
        )
    }

    @Test
    fun `a clickable ancestor does not need gesture tap`() {
        assertFalse(
            DouyinCollectService.mustGestureTap(listOf(false, false, true, false))
        )
    }

    @Test
    fun `empty chain defensively must gesture tap`() {
        assertTrue(
            DouyinCollectService.mustGestureTap(emptyList())
        )
    }
}
