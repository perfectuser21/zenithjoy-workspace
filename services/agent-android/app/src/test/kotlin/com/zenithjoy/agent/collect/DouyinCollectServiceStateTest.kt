package com.zenithjoy.agent.collect

import android.content.Intent
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

    // ── mayStartStage1Work（单飞闩） ─────────────────────────────────────────
    // 真机复现(2026-07-11, e8597732 考研 ALL_SHARE_FAILED 0/3)：单个 task 只派发一次，
    // 但 triggerSearch 在采集已启动后二次触发，把 state 从 COLLECTING_VIDEO_CARDS 重置回
    // WAITING_SEARCH_RESULTS，第二个 cards=3 搜索结果事件再次进入 handleSearchResults →
    // 并发启动第二个 collectVideoCards 协程。两个协程同时驱动抖音 UI，互相 recycle 对方的
    // AccessibilityNodeInfo 树 → 详情页树塌缩(childCount>0 但 getChild 全 null，分享按钮
    // 找不到 STEP2)/分享面板抓不到(STEP3)/卡数掉到 1(STEP1) → 全卡片取链失败 ALL_SHARE_FAILED。
    // 仅靠 state 守卫不够（state 会被 triggerSearch 重置）；必须用单调闩：一个 task 只允许
    // 启动一次采集 / 一次搜索触发，收到新 task（startCollect）才复位。

    @Test
    fun `first stage1 work is allowed when collection not yet launched`() {
        assertTrue(DouyinCollectService.mayStartStage1Work(collectionAlreadyLaunched = false))
    }

    @Test
    fun `second concurrent stage1 work is blocked after collection launched (真机 ALL_SHARE_FAILED 根因)`() {
        assertFalse(
            "采集已启动后禁止再启动第二个 collectVideoCards / 再触发搜索，否则两协程并发 recycle UIA 树 → ALL_SHARE_FAILED",
            DouyinCollectService.mayStartStage1Work(collectionAlreadyLaunched = true)
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

    // ── decideStage1ResultsAction ────────────────────────────────────────────
    // 真机复现(2026-07-11，用户现场肉眼定位)：搜索结果默认落"综合"tab，直播/视频/用户
    // 混排且直播常排前。旧逻辑只要 findVideoCards 非空就立即采集，从没检查过是不是已经
    // 切到"视频"tab —— 在"综合"tab 上一样能凑出 3 张"卡片"（其实混了直播间），脚本一点
    // 就进直播间（无普通视频分享取链路径）→ 全卡 ALL_SHARE_FAILED。根治：即使已经找到卡片，
    // 只要本 task 还没切过一次"视频"tab，也必须先切标签，不能直接采。

    @Test
    fun `must switch to video tab first even though cards already found on 综合 tab (真机撞直播间根因)`() {
        assertEquals(
            DouyinCollectService.ResultsAction.WAIT_FOR_TAB_SWITCH,
            DouyinCollectService.decideStage1ResultsAction(videoCardsFound = true, alreadyTriedTabSwitch = false)
        )
    }

    @Test
    fun `collects once tab switch already attempted this task`() {
        assertEquals(
            DouyinCollectService.ResultsAction.COLLECT,
            DouyinCollectService.decideStage1ResultsAction(videoCardsFound = true, alreadyTriedTabSwitch = true)
        )
    }

    @Test
    fun `ignores results event with no cards regardless of tab switch state`() {
        assertEquals(
            DouyinCollectService.ResultsAction.IGNORE,
            DouyinCollectService.decideStage1ResultsAction(videoCardsFound = false, alreadyTriedTabSwitch = false)
        )
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
    // 真机复现(Douyin 39.5.0)：无障碍节点广泛 clickable=false + resource-id 混淆。
    // Android performAction(ACTION_CLICK) 只作用于被调用的节点、不冒泡到祖先。findNodeByText
    // 命中的往往是内层不可点击元素（TextView/Button），对它 ACTION_CLICK 是空操作。
    //
    // 两处真机实证：
    //   ① 搜索入口 "搜索" TextView(id 4ty)：整条祖先链 clickable 全 false → NO_SEARCH_INPUT。
    //   ② 搜索结果 "综合"/"视频" 标签：命中的 Button 自身 clickable=false，祖先 ActionBar$Tab
    //      clickable=true，但对该祖先 performAction(ACTION_CLICK) 实测【不生效】——只有对
    //      命中节点中心坐标手势才真正切换标签（uiautomator dump + input tap 实证）→ 未修时
    //      标签切不动、结果页停在空的"主页" → SEARCH_TIMEOUT。
    //
    // 结论：判据不能是"整条链是否有可点击节点"（②的祖先可点击却仍点不动），而应是
    // 【命中节点自身是否可点击】——自身不可点击就必须退回坐标手势模拟真实触摸。

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
    fun `non-clickable node with clickable ancestor must gesture tap (真机 综合标签场景)`() {
        // "综合" 标签真机链：Button(false) → RelativeLayout(false) → ActionBar$Tab(true)。
        // 祖先可点击，但对祖先 ACTION_CLICK 实测不切标签，只有坐标手势有效——
        // 命中节点(index 0)自身不可点击即必须坐标手势。
        assertTrue(
            DouyinCollectService.mustGestureTap(listOf(false, false, true, false))
        )
    }

    @Test
    fun `empty chain defensively must gesture tap`() {
        assertTrue(
            DouyinCollectService.mustGestureTap(emptyList())
        )
    }

    // ── shouldHonorTimeoutFiring（看门狗重入根治） ────────────────────────────
    // 真机复现(2026-07-11 xian-rog 荣耀)：tab 点击后 67ms 内又打出一条 timeout fired
    // triedTab=true → SEARCH_TIMEOUT，不符合 10s 超时协程的正常计时节奏。根因：
    // startSearchResultTimeout() 每次调用都 new 一个协程，从不 cancel 旧协程——事件驱动
    // 重试(handleSearchResults WAIT_FOR_TAB_SWITCH 分支)只重置 searchTriggeredAtMs 不重启
    // 看门狗，超时驱动重试虽重新调用但也不 cancel 旧协程。多个看门狗并发存活，各自用创建
    // 时刻起算的 10s 预算，与最新 triedTabSwitch 状态不同步——一个更早、还没到期的旧看门狗
    // 读到已被别的协程改成 true 的 triedTabSwitch，直接判失败，这时刚点下去的 tab 切换手势
    // 其实还没来得及生效。修法：每个看门狗持有创建时的 generation 快照，到期时只有仍是
    // 最新 generation 的那个才有权处理，被更新的 generation 取代的旧看门狗必须静默放弃。

    @Test
    fun `stale watchdog generation must not fire after being superseded (真机 67ms 假超时根因)`() {
        assertFalse(
            "旧看门狗的 generation 已被新一轮 tab 切换重试取代，不该再判定超时",
            DouyinCollectService.shouldHonorTimeoutFiring(myGeneration = 1, latestGeneration = 2)
        )
    }

    @Test
    fun `current watchdog generation is honored`() {
        assertTrue(
            DouyinCollectService.shouldHonorTimeoutFiring(myGeneration = 2, latestGeneration = 2)
        )
    }

    // ── stage1LaunchFlags ────────────────────────────────────────────────────
    // 真机复现(2026-07-11)：采集取分享链会点进视频 DetailActivity，任务中途死亡把抖音 task
    // 栈留在详情页。仅 NEW_TASK 启动会 resume 到残留详情页而非首页 feed → openSearchBar
    // 找不到"搜索"入口 → 关键词打进详情页聊天框 → 结果页永不出现 → SEARCH_TIMEOUT。
    // dumpsys 证 topResumedActivity=DetailActivity；CLEAR_TASK 清栈后回干净首页 feed 恢复。
    // 结论：Stage1 启动 flags 必须叠加 FLAG_ACTIVITY_CLEAR_TASK，否则换台机器/换个任务必复发。

    @Test
    fun `stage1 launch flags must include CLEAR_TASK to escape stale DetailActivity`() {
        val flags = DouyinCollectService.stage1LaunchFlags(base = 0)
        assertTrue(
            "Stage1 启动必须带 CLEAR_TASK 清空残留 DetailActivity 栈，否则 resume 到详情页 → SEARCH_TIMEOUT",
            (flags and Intent.FLAG_ACTIVITY_CLEAR_TASK) != 0
        )
    }

    @Test
    fun `stage1 launch flags must include NEW_TASK`() {
        // CLEAR_TASK 必须与 NEW_TASK 同用才生效（Android 契约）。
        val flags = DouyinCollectService.stage1LaunchFlags(base = 0)
        assertTrue(
            (flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0
        )
    }

    @Test
    fun `stage1 launch flags preserve existing base flags`() {
        // 不能丢弃 getLaunchIntentForPackage 原有 flags。
        val base = 0x00100000 // 任意已有 flag 位
        val flags = DouyinCollectService.stage1LaunchFlags(base = base)
        assertTrue((flags and base) == base)
    }
}
