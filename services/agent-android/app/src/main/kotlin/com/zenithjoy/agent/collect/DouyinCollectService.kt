package com.zenithjoy.agent.collect

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import com.zenithjoy.agent.account.ScanMutex

/**
 * 抖音无障碍采集服务。
 *
 * 功能：接收 COLLECT_TASK Intent → 驱动状态机完成
 *   关键词搜索 → 点第一条视频（爆款视频，作为参照/竞品账号定位入口）
 *   → 打开评论区 → 抓取每条留言的「留言人 + 留言内容」→ 回调结果
 *
 * 采集目标是评论区的留言人，不是视频作者本人——作者只是搜索关键词定位到的参照账号，
 * 主动在这条视频下留言的人才是对该话题有真实需求的精准获客线索。
 *
 * 不依赖 adb/开发者模式；仅需用户在「设置→无障碍」中开启本服务。
 * 操作间隔均由 [RandomDelay] 提供随机区间，禁止固定常量。
 */
class DouyinCollectService : AccessibilityService() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var onResult: ((CollectResult) -> Unit)? = null

    // 每次状态变化刷新时间戳：busy-guard 用它判断"非 IDLE 是真忙还是流程已死"
    // （真机复现 2026-07-10：state 卡非 IDLE 且无看门狗覆盖时新任务被永久拒绝）。
    @Volatile private var stateChangedAtMs = 0L
    private var state = State.IDLE
        set(value) {
            field = value
            stateChangedAtMs = android.os.SystemClock.elapsedRealtime()
        }
    private var currentKeyword = ""
    private var currentTaskId = ""
    private var searchTriggeredAtMs = 0L
    // A2 重入闸：评论面板每个无障碍事件都会 launch 一个提取协程，state 切走前已排队多个，
    // 导致 reportResult 被调 7~12 次、onResult 重复上报。用一次性闩保证一个任务只上报一次。
    @Volatile private var resultReported = false
    // 真机复现(2026-07-10)：抖音搜索默认落在"主页"标签（找账号主页用的，天然没有视频卡片），
    // 真实视频内容在"综合"/"视频"标签。首次超时先尝试切标签重试一次，避免误判 SEARCH_TIMEOUT。
    private var triedTabSwitch = false

    // Bug C 剪贴板路线：等待 ShareIngestActivity 读回的短链，带 token 防跨卡串号。
    // 载荷携带 (短链文案, clip 写入时间戳)——时间戳供服务侧新鲜度闸判残留旧短链串号。
    @Volatile private var pendingShareCapture: Pair<Long, CompletableDeferred<ShareCapturePayload?>>? = null
    @Volatile private var pendingClearDone: Pair<Long, CompletableDeferred<Boolean>>? = null
    // 拉起回执：Activity onCreate 时置为其 token，服务侧 consume 判定拉起成功
    @Volatile private var ingestLaunchedToken: Long = Long.MIN_VALUE
    private var shareTokenSeq = 0L
    private val seenShareUrls = mutableSetOf<String>()

    internal enum class State {
        IDLE,
        OPENING_DOUYIN,
        TYPING_KEYWORD,
        SUBMITTING_SEARCH,
        WAITING_SEARCH_RESULTS,
        COLLECTING_VIDEO_CARDS,  // Stage1：从搜索结果收集多张视频卡
        OPENING_FIRST_VIDEO,
        OPENING_COMMENTS,
        EXTRACTING_COMMENTS,
        OPENING_VIDEO_URL,       // Stage2：通过深链打开指定视频
    }

    // 任务模式：Stage1 搜索收集视频卡 / Stage2 按 URL 收集评论
    private enum class Mode { STAGE1_SEARCH, STAGE2_VIDEO_URL }
    private var currentMode = Mode.STAGE1_SEARCH
    private var currentVideoId = ""  // Stage2 当前处理的 video_id

    private val taskReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            android.util.Log.i(TAG, "onReceive fired: action=${intent?.action}")
            if (intent?.action != ACTION_COLLECT_TASK) return
            val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""
            if (state != State.IDLE) {
                val now = android.os.SystemClock.elapsedRealtime()
                if (isBusyStateStale(stateChangedAtMs, now, STUCK_STATE_RESET_MS)) {
                    // 流程已死（state 停留超阈值），强制复位后照常接受本次任务
                    android.util.Log.w(TAG, "stale state=$state (${now - stateChangedAtMs}ms) — force reset, accepting task $taskId")
                    state = State.IDLE
                    ScanMutex.busy = false
                } else {
                    android.util.Log.w(TAG, "busy — rejecting task $taskId")
                    onTaskRejected?.invoke(taskId)
                    return
                }
            }
            val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_STAGE1
            if (mode == MODE_STAGE2) {
                val videoUrl = intent.getStringExtra(EXTRA_VIDEO_URL) ?: return
                val videoId = intent.getStringExtra(EXTRA_VIDEO_ID) ?: ""
                android.util.Log.i(TAG, "stage2 task received: videoId=$videoId id=$taskId")
                onTaskAccepted?.invoke(taskId)
                startStage2Collect(videoUrl, videoId, taskId)
            } else {
                val keyword = intent.getStringExtra(EXTRA_KEYWORD) ?: return
                android.util.Log.i(TAG, "stage1 task received: keyword=$keyword id=$taskId")
                onTaskAccepted?.invoke(taskId)
                startCollect(keyword, taskId)
            }
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        activeInstance = this
        registerReceiver(taskReceiver, IntentFilter(ACTION_COLLECT_TASK),
            RECEIVER_NOT_EXPORTED)
        android.util.Log.i(TAG, "accessibility service connected")
    }

    override fun onDestroy() {
        if (activeInstance === this) activeInstance = null
        scope.cancel()
        unregisterReceiver(taskReceiver)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        when (state) {
            State.TYPING_KEYWORD -> handleTypingKeyword(event)
            State.WAITING_SEARCH_RESULTS -> handleSearchResults(event)
            State.COLLECTING_VIDEO_CARDS -> Unit  // 在 collectVideoCards() 协程中处理
            State.OPENING_FIRST_VIDEO -> handleVideoOpened(event)
            State.OPENING_COMMENTS -> handleCommentsOpened(event)
            State.EXTRACTING_COMMENTS -> Unit
            State.OPENING_VIDEO_URL -> handleVideoUrlOpened(event)
            else -> Unit
        }
    }

    override fun onInterrupt() {
        android.util.Log.w(TAG, "service interrupted")
    }

    // ── 任务入口 ──────────────────────────────────────────────────────────────

    private fun startCollect(keyword: String, taskId: String) {
        currentKeyword = keyword
        currentTaskId = taskId
        currentMode = Mode.STAGE1_SEARCH
        currentVideoId = ""
        resultReported = false
        triedTabSwitch = false
        state = State.OPENING_DOUYIN
        ScanMutex.busy = true

        scope.launch {
            val launched = launchDouyin()
            if (!launched) {
                finishWithError("LAUNCH_FAILED")
                return@launch
            }
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            openSearchBar()
        }
    }

    // Stage2 入口：通过深链打开指定视频，进评论区抓评论
    private fun startStage2Collect(videoUrl: String, videoId: String, taskId: String) {
        currentKeyword = videoUrl
        currentTaskId = taskId
        currentMode = Mode.STAGE2_VIDEO_URL
        currentVideoId = videoId
        resultReported = false
        triedTabSwitch = false
        state = State.OPENING_VIDEO_URL
        ScanMutex.busy = true

        scope.launch {
            val launched = launchVideoByDeepLink(videoId)
            if (!launched) {
                finishWithError("DEEPLINK_LAUNCH_FAILED")
                return@launch
            }
            startVideoUrlOpenTimeout()
        }
    }

    // 深链打开抖音视频：snssdk1128://aweme/detail/<videoId>
    private fun launchVideoByDeepLink(videoId: String): Boolean {
        return try {
            val uri = Uri.parse("snssdk1128://aweme/detail/$videoId")
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            applicationContext.startActivity(intent)
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "deeplink launch failed videoId=$videoId: ${e.message}")
            false
        }
    }

    private fun startVideoUrlOpenTimeout() {
        scope.launch {
            delay(VIDEO_OPEN_TIMEOUT_MS)
            if (state == State.OPENING_VIDEO_URL) {
                finishWithError("VIDEO_URL_OPEN_TIMEOUT")
            }
        }
    }

    // Stage2：等待视频页面加载后点评论按钮（与 handleVideoOpened 逻辑相同）
    private fun handleVideoUrlOpened(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return
        if (state != State.OPENING_VIDEO_URL) return
        if (event.packageName != DOUYIN_PKG) return

        val root = rootInActiveWindow ?: return
        val commentBtn = findNodeByContentDescPrefix(root, "评论") ?: findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/iv_comment",
            "com.ss.android.ugc.aweme:id/comment_icon",
            "com.ss.android.ugc.aweme:id/tv_comment_count",
            "com.ss.android.ugc.aweme:id/comment_count",
        )
        if (commentBtn == null) return

        state = State.OPENING_COMMENTS
        commentBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        startCommentsTimeout()
        startExtractionWatchdog()
    }

    // ── 1. 启动抖音 ───────────────────────────────────────────────────────────

    private fun launchDouyin(): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(DOUYIN_PKG) ?: return false
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            applicationContext.startActivity(launchIntent)
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "launch douyin failed: ${e.message}")
            false
        }
    }

    // ── 2. 打开搜索框 ─────────────────────────────────────────────────────────
    //
    // 真机验证发现：固定延时一次性抓 rootInActiveWindow 不可靠——荣耀设备在
    // 拉起目标 App 前会插一屏厂商自己的启动提示（AppSplashAdvertiseActivity），
    // 导致抖音真正进入前台窗口的时间点比固定延时更晚、且不固定。原来"抓不到
    // 就直接判死"的写法，会把这种正常的启动抖动误判成致命错误。改成有限次
    // 轮询重试，只有整个重试窗口内都拿不到根节点才真正判失败。

    private fun openSearchBar() {
        state = State.TYPING_KEYWORD
        scope.launch {
            val root = awaitRootInActiveWindow() ?: run {
                finishWithError("NO_WINDOW")
                return@launch
            }
            // 真机验证发现：抖音的 resource-id 是混淆过的短乱码（如 "0fs"/"6ia"），
            // 猜测式的人类可读 id（search_btn/iv_search 等）在真实包里根本不存在。
            // content-description（无障碍朗读用的文案，如"搜索"）不受混淆影响，
            // 真机 dump 验证过存在，改为优先按 content-desc 匹配。
            val searchBtn = findNodeByContentDesc(root, "搜索") ?: findNodeByIds(root,
                "com.ss.android.ugc.aweme:id/search_btn",
                "com.ss.android.ugc.aweme:id/iv_search",
                "com.ss.android.ugc.aweme:id/action_search",
            )
            // 真机验证发现：点击搜索按钮后页面已经跳转到搜索输入页，但如果这里
            // 继续用点击前的 root 快照调 typeKeyword，那个快照里根本没有输入框，
            // 必然报 NO_SEARCH_INPUT——从没进过搜索页。点击后必须重新抓一次
            // root，才能看到跳转后的真实界面。
            //
            // 真机 uiautomator dump 实测（Douyin 39.5.0）：搜索 "搜索" TextView(id 4ty)
            // 整条无障碍祖先链 clickable=false，performAction(ACTION_CLICK) 是空操作、
            // 点不动，页面根本不跳转 → 之前恒报 NO_SEARCH_INPUT。改用 clickNodeRobustly
            // （链上无可点击节点时退回坐标手势），对齐 triggerSearch 早已采用的 tapNodeCenter。
            val postClickRoot = if (searchBtn != null) {
                clickNodeRobustly(searchBtn)
                delay(RandomDelay.sample(RandomDelay.CLICK_MS))
                awaitRootInActiveWindow(attempts = 4) ?: root
            } else {
                root
            }
            typeKeyword(postClickRoot)
        }
    }

    /** 有限次轮询等待窗口根节点就绪，替代"一次固定延时后抓不到就判死"。 */
    private suspend fun awaitRootInActiveWindow(
        attempts: Int = 8,
        intervalMs: Long = 500L,
    ): AccessibilityNodeInfo? {
        repeat(attempts) { attempt ->
            delay(intervalMs)
            rootInActiveWindow?.let { return it }
            android.util.Log.d(TAG, "awaitRootInActiveWindow: attempt ${attempt + 1}/$attempts still null")
        }
        return rootInActiveWindow
    }

    // ── 3. 输入关键词 ─────────────────────────────────────────────────────────

    private fun typeKeyword(root: AccessibilityNodeInfo) {
        val searchInput = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/search_input",
            "com.ss.android.ugc.aweme:id/search_edit_text",
            "com.ss.android.ugc.aweme:id/et_search_kw",
        ) ?: findFirstEditText(root)

        if (searchInput == null) {
            finishWithError("NO_SEARCH_INPUT")
            return
        }

        searchInput.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, currentKeyword)
        }
        searchInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        scope.launch {
            delay(RandomDelay.sample(RandomDelay.SEARCH_MS))
            // 真机实测确认(2026-07-09)：这里之前有 performGlobalAction(GLOBAL_ACTION_BACK)
            // 想收起键盘，但抖音搜索输入页把"返回"当成"清空/退出搜索"处理——手动复现过，
            // 打字确认输入框有内容后按一次返回，输入框会清空回到占位文案，导致后面提交的
            // 是首页热搜占位词而不是真实关键词。键盘不收起不影响后续点"搜索"按钮（按钮在
            // 输入框同一行，不会被键盘遮挡），故直接去掉这步，不再按返回。
            // 之前这里拿不到根节点就静默 return@launch：triggerSearch() 从未被调用，
            // 唯一的看门狗 startSearchResultTimeout() 只在 triggerSearch() 内部启动，
            // 导致服务永久卡死在 SUBMITTING_SEARCH，后续任务全被 busy-guard 拒绝，
            // 只能重启进程恢复。改为显式判空并调用 finishWithError 上报错误、把
            // state 复位回 IDLE。
            val submitRoot = rootInActiveWindow
            if (submitRoot == null) {
                finishWithError("NO_WINDOW_BEFORE_SUBMIT")
                return@launch
            }
            triggerSearch(submitRoot)
        }
    }

    // ── 4. 触发搜索 ───────────────────────────────────────────────────────────

    private fun triggerSearch(root: AccessibilityNodeInfo) {
        val confirmBtn = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/search_confirm",
            "com.ss.android.ugc.aweme:id/btn_search",
        )
        val searchTextNode = findNodeByText(root, "搜索")
        // 真机 adb + uiautomator dump 实测确认（Douyin 39.5.0）：确认按钮 resource-id
        // 被混淆成随机短串(如 "4ty")，且该节点及所有祖先 clickable=false——
        // performAction(ACTION_CLICK) 点不到，必须用手势坐标模拟真实触摸（已用
        // `input tap` 原始坐标验证能成功提交搜索）。
        when {
            confirmBtn != null -> confirmBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            searchTextNode != null -> tapNodeCenter(searchTextNode)
            else -> {
                // 找不到确认按钮时，用 ACTION_IME_ENTER 确认 IME 的搜索/回车动作兜底——
                // 之前误用 ACTION_NEXT_AT_MOVEMENT_GRANULARITY（按粒度移动光标），
                // 那不是提交搜索的动作，是这个 bug 的根因之一。
                val input = findFirstEditText(root)
                input?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
            }
        }
        searchTriggeredAtMs = android.os.SystemClock.elapsedRealtime()
        state = State.WAITING_SEARCH_RESULTS
        startSearchResultTimeout()
    }

    private fun startSearchResultTimeout() {
        scope.launch {
            val found = withTimeoutOrNull(10_000L) {
                while (state == State.WAITING_SEARCH_RESULTS) delay(300)
                true
            }
            if (found == null && state == State.WAITING_SEARCH_RESULTS) {
                // 真机复现：抖音搜索默认落在"主页"标签（空，找账号用），视频内容在"综合"/
                // "视频"标签。先尝试切标签重试一次，不是每次超时都直接判失败。
                if (shouldRetryWithTabSwitch(triedTabSwitch) && trySwitchToVideoTab()) {
                    triedTabSwitch = true
                    searchTriggeredAtMs = android.os.SystemClock.elapsedRealtime()
                    startSearchResultTimeout()
                } else {
                    finishWithError("SEARCH_TIMEOUT")
                }
            }
        }
    }

    /** 找"综合"或"视频"标签并点击切换，返回是否成功找到并点击。 */
    private fun trySwitchToVideoTab(): Boolean {
        val root = rootInActiveWindow ?: return false
        val tab = findNodeByText(root, "综合") ?: findNodeByText(root, "视频") ?: return false
        // 真机实测(Douyin 39.5.0)：命中的"综合"Button clickable=false，对其祖先 ActionBar$Tab
        // performAction(ACTION_CLICK) 不切标签，只有坐标手势有效。走 clickNodeRobustly 统一判据。
        clickNodeRobustly(tab)
        return true
    }

    // ── 5. 搜索结果页：Stage1 收集多视频卡 / 旧协议点第一条视频 ─────────────

    private fun handleSearchResults(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return
        if (state != State.WAITING_SEARCH_RESULTS) return
        if (isResultEventDebounced(searchTriggeredAtMs, android.os.SystemClock.elapsedRealtime(), RESULTS_SETTLE_MS)) return

        val root = rootInActiveWindow ?: return

        if (currentMode == Mode.STAGE1_SEARCH) {
            // Stage1：收集多张视频卡的 video_id，不进评论区
            val videoCards = findVideoCards(root, MAX_VIDEOS_PER_SEARCH)
            if (videoCards.isEmpty()) return
            state = State.COLLECTING_VIDEO_CARDS
            scope.launch { collectVideoCards(videoCards) }
        } else {
            // 旧协议/默认：点第一条视频进评论区
            val videoCard = findFirstVideoCard(root) ?: return
            state = State.OPENING_FIRST_VIDEO
            videoCard.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            startVideoOpenTimeout()
        }
    }

    // Stage1（Bug C 修复）：不再从节点树猜 video_id（搜索结果整棵树无真实 ≥10 位数字 id，
    // 只能造假，导致 Stage2 深链打不开）。改为逐张卡片走剪贴板取链：点开视频 → 点分享 →
    // 分享面板点「分享链接」→ 口令进剪贴板 → 透明 Activity 前台获焦读回 → 抽 v.douyin.com
    // 短链上报 shareUrl，真实 id 由服务端跟随 302 解析。
    // 拿不到短链的卡片直接跳过（绝不造假 id）；全部失败上报空清单带 ALL_SHARE_FAILED。
    private suspend fun collectVideoCards(videoCards: List<AccessibilityNodeInfo>) {
        if (resultReported) return
        seenShareUrls.clear()
        val targetCount = minOf(videoCards.size, MAX_VIDEOS_PER_SEARCH)
        val collected = mutableListOf<VideoCardInfo>()
        var consecutiveFailures = 0
        for (index in 0 until targetCount) {
            val shareUrl = captureShareUrlForCard(index)
            pendingShareCapture = null
            pendingClearDone = null
            if (shareUrl != null) {
                collected.add(VideoCardInfo(videoId = "", keyword = currentKeyword, shareUrl = shareUrl))
                seenShareUrls.add(shareUrl)
                consecutiveFailures = 0
                android.util.Log.i(TAG, "Stage1 card#$index share_url captured: $shareUrl")
            } else {
                consecutiveFailures++
                android.util.Log.w(TAG, "Stage1 card#$index share_url capture failed — skip ($consecutiveFailures)")
                if (consecutiveFailures >= 2) {
                    android.util.Log.w(TAG, "Stage1 aborting: 2 consecutive failures")
                    break
                }
            }
            navigateBackToResults()
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
        }
        android.util.Log.i(TAG, "Stage1 collected ${collected.size}/$targetCount for keyword=$currentKeyword")
        if (collected.isEmpty()) {
            reportVideoCards(emptyList(), error = "ALL_SHARE_FAILED")
        } else {
            reportVideoCards(collected, error = "")
        }
    }

    // 单张卡片的剪贴板取链：点开视频 → 点分享 → 面板点「分享链接」→ 透明 Activity 读剪贴板。
    // 全程硬超时 PER_CARD_TIMEOUT_MS，任何一步失败返回 null（该卡片跳过，不造假）。
    private suspend fun captureShareUrlForCard(index: Int): String? {
        return withTimeoutOrNull(PER_CARD_TIMEOUT_MS) {
            // 1. 重抓卡并点开详情
            val listRoot = rootInActiveWindow ?: run {
                android.util.Log.w(TAG, "capture abort card#$index: STEP1_listRoot_null")
                return@withTimeoutOrNull null
            }
            val cards = findVideoCards(listRoot, MAX_VIDEOS_PER_SEARCH)
            val card = cards.getOrNull(index) ?: run {
                android.util.Log.w(TAG,
                    "capture abort card#$index: STEP1_no_card (found=${cards.size} listChild=${listRoot.childCount})")
                dumpNodeDescs(listRoot, "list")
                return@withTimeoutOrNull null
            }
            tapNodeCenter(card)
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            val detailRoot = awaitRootInActiveWindow(attempts = 6) ?: run {
                android.util.Log.w(TAG, "capture abort card#$index: STEP1_detailRoot_null (tap didn't yield a window)")
                return@withTimeoutOrNull null
            }
            // 详情页树全景：定位分享按钮实际 desc / 是否折叠
            dumpNodeDescs(detailRoot, "detail")

            // 2. 点分享
            val shareBtn = findNodeByContentDescPrefix(detailRoot, "分享")
                ?: findNodeByContentDescPrefix(detailRoot, "转发")
                ?: run {
                    android.util.Log.w(TAG,
                        "capture abort card#$index: STEP2_no_share_btn (detailChild=${detailRoot.childCount})")
                    return@withTimeoutOrNull null
                }
            tapNodeCenter(shareBtn)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))

            // 3. 等分享面板出现（内容锚点，不用裸 root）
            awaitSharePanel() ?: run {
                android.util.Log.w(TAG, "capture abort card#$index: STEP3_share_panel_not_shown")
                dumpNodeDescs(rootInActiveWindow, "panel-miss")
                return@withTimeoutOrNull null
            }

            // 4. 清剪贴板基线（透明 Activity clear 模式）
            if (!clearClipboardBaseline()) {
                android.util.Log.w(TAG, "capture abort card#$index: STEP4_clear_baseline_failed")
                return@withTimeoutOrNull null
            }

            // 4.5 clear 透明 Activity 两次焦点切换后，step3 抓的旧节点快照已失效
            //（AccessibilityNodeInfo 跨窗口 stale，遍历为空 → 整任务假失败）。
            // 必须重抓 root 并确认仍在分享面板，用新 root 找按钮；不在面板则该卡跳过。
            val panelRoot = rootInActiveWindow ?: return@withTimeoutOrNull null
            if (!ClipboardCaptureGate.isSharePanel(collectNodeTexts(panelRoot))) {
                android.util.Log.w(TAG, "share panel gone after clear baseline — skip card#$index")
                return@withTimeoutOrNull null
            }

            // 5. 面板里找"分享链接"（别名表 + 面板子树 + 滚动 ≤3）
            val linkBtn = findShareLinkButton(panelRoot) ?: run {
                android.util.Log.w(TAG, "capture abort card#$index: STEP5_no_share_link_btn")
                dumpNodeDescs(panelRoot, "panel")
                return@withTimeoutOrNull null
            }

            // 6. 点"分享链接" → 拉起透明 Activity 读剪贴板
            val token = ++shareTokenSeq
            val deferred = CompletableDeferred<ShareCapturePayload?>()
            pendingShareCapture = token to deferred
            // 必须用 uptimeMillis()：要与 ClipDescription.getTimestamp() 同一时间基做 isFresh 比较。
            // 绝不能用 elapsedRealtime()（含深睡时间、绝对值偏大，会把新鲜短链误判陈旧→漏采）。
            val clickAtMs = android.os.SystemClock.uptimeMillis()
            tapNodeCenter(linkBtn)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            startActivity(ShareIngestActivity.launchReadIntent(this@DouyinCollectService, token))

            // 7. 拉起回执（区分环境阻断）
            if (!awaitLaunchEcho(token)) {
                android.util.Log.w(TAG, "ACTIVITY_LAUNCH_BLOCKED token=$token")
                return@withTimeoutOrNull null
            }

            // 8. 等读回短链 + clip 写入时间戳
            val payload = withTimeoutOrNull(READ_DELIVER_MS) { deferred.await() } ?: return@withTimeoutOrNull null
            val link = payload.link ?: return@withTimeoutOrNull null

            // 9. 准入双闸：新鲜度（clip 写入晚于点击=非残留旧短链）+ 去重。
            // 残留旧短链 clipTs ≤ clickAtMs 会被时间戳闸拦下——堵死"剪贴板残留短链串号造假"。
            if (!ClipboardCaptureGate.admitShareUrl(link, payload.clipTimestampMs, clickAtMs, seenShareUrls)) {
                android.util.Log.w(TAG,
                    "share_url rejected (stale/duplicate) link=$link clipTs=${payload.clipTimestampMs} clickAt=$clickAtMs — skip")
                return@withTimeoutOrNull null
            }
            android.util.Log.i(TAG, "card#$index fresh link=$link (clipTs=${payload.clipTimestampMs} clickAt=$clickAtMs)")
            link
        }
    }

    // 分享面板出现判定：内容锚点（含取消/发送给朋友或 ≥2 别名命中）
    private suspend fun awaitSharePanel(): AccessibilityNodeInfo? {
        repeat(PANEL_MAX_ATTEMPTS) {
            val root = rootInActiveWindow
            if (root != null && ClipboardCaptureGate.isSharePanel(collectNodeTexts(root))) return root
            delay(PANEL_SETTLE_MS)
        }
        return null
    }

    // 清剪贴板基线：拉起 clear 模式 Activity，等 CLEAR_DONE
    private suspend fun clearClipboardBaseline(): Boolean {
        val token = ++shareTokenSeq
        val done = CompletableDeferred<Boolean>()
        pendingClearDone = token to done
        startActivity(ShareIngestActivity.launchClearIntent(this@DouyinCollectService, token))
        if (!awaitLaunchEcho(token)) return false
        val ok = withTimeoutOrNull(CLEAR_WAIT_MS) { done.await() } ?: false
        // clear Activity finish 后回到分享面板需要一瞬
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        return ok
    }

    private suspend fun awaitLaunchEcho(token: Long): Boolean {
        val deadline = android.os.SystemClock.elapsedRealtime() + LAUNCH_ECHO_TIMEOUT_MS
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if (consumeIngestLaunched(token)) return true
            delay(LAUNCH_ECHO_POLL_MS)
        }
        return false
    }

    // 面板子树里找"分享链接"，找不到滚功能排 ≤3 次
    private suspend fun findShareLinkButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        matchLinkNode(root)?.let { return it }
        val scrollable = findScrollableNode(root) ?: return null
        repeat(3) {
            if (!scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return null
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            val fresh = rootInActiveWindow ?: return null
            matchLinkNode(fresh)?.let { return it }
        }
        return null
    }

    private fun matchLinkNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (ClipboardCaptureGate.matchShareLinkLabel(
                    node.text?.toString(), node.contentDescription?.toString())) {
                return node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun collectNodeTexts(root: AccessibilityNodeInfo): List<String> {
        val out = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var n = 0
        while (queue.isNotEmpty() && n++ < MAX_FLATTEN_NODES) {
            val node = queue.removeFirst()
            node.text?.toString()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            node.contentDescription?.toString()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return out
    }

    /** 服务侧查 startActivity 后 Activity 是否已 onCreate（回执 token 匹配），查后清。 */
    private fun consumeIngestLaunched(token: Long): Boolean {
        val ok = ingestLaunchedToken == token
        if (ok) ingestLaunchedToken = Long.MIN_VALUE
        return ok
    }

    private fun findScrollableNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    // 从视频详情/分享面板 BACK 回搜索结果页，锚点 = 抖音包内能再找到视频卡。最多按 3 次。
    private suspend fun navigateBackToResults() {
        repeat(3) {
            val root = rootInActiveWindow
            if (root != null && root.packageName == DOUYIN_PKG &&
                findVideoCards(root, 1).isNotEmpty()) {
                return
            }
            performGlobalAction(GLOBAL_ACTION_BACK)
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
        }
    }

    private fun reportVideoCards(videos: List<VideoCardInfo>, error: String) {
        if (resultReported) return
        resultReported = true
        state = State.IDLE
        ScanMutex.busy = false
        onVideoCardResult?.invoke(currentTaskId, currentKeyword, videos, error)
        // AgentService 的队列状态机对同一结果不幂等：回调+广播双投递会把下一个
        // 在跑的 job 提前 markCurrentDone，重新引入 busy 静默丢任务。
        // 兜底广播只在回调缺席时才发。
        if (!shouldSendFallbackBroadcast(onVideoCardResult != null)) return
        val intent = Intent(ACTION_COLLECT_RESULT).apply {
            setPackage(packageName)
            putExtra(EXTRA_TASK_ID, currentTaskId)
            putExtra(EXTRA_RESULT_OK, videos.isNotEmpty())
            putExtra(EXTRA_RESULT_ERROR, "")
        }
        sendBroadcast(intent)
    }

    // 真机复现两次：评论按钮(content-desc/resource-id)一旦在当前抖音版本/视频页找不到，
    // handleVideoOpened() 会直接 return，state 永久停在 OPENING_FIRST_VIDEO——跟
    // WAITING_SEARCH_RESULTS 同样需要有界超时兜底，否则任务永久挂起、mutex 不释放。
    private fun startVideoOpenTimeout() {
        scope.launch {
            delay(VIDEO_OPEN_TIMEOUT_MS)
            if (state == State.OPENING_FIRST_VIDEO) {
                finishWithError("COMMENT_BUTTON_NOT_FOUND")
            }
        }
    }

    private fun handleTypingKeyword(event: AccessibilityEvent) {
        // 等待搜索框出现（window change 后再输入）
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.packageName == DOUYIN_PKG
        ) {
            val root = rootInActiveWindow ?: return
            val input = findFirstEditText(root) ?: return
            if (shouldEnterSubmitting(state)) {
                // 切到 SUBMITTING_SEARCH（不是 WAITING_SEARCH_RESULTS）：这个过渡态在
                // onAccessibilityEvent 分发表里没有对应 handler，既防止 typeKeyword
                // 被重复调用，又不会让联想词/历史列表刷新事件被误路由到
                // handleSearchResults() 造成误点击。真正的 WAITING_SEARCH_RESULTS
                // 要等 triggerSearch() 真正发出搜索动作之后才切换。
                state = State.SUBMITTING_SEARCH
                typeKeyword(root)
            }
        }
    }

    // ── 6. 打开评论区 ─────────────────────────────────────────────────────────
    //
    // 不进作者主页——直接点评论按钮/评论数，进评论列表。

    private fun handleVideoOpened(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return
        if (state != State.OPENING_FIRST_VIDEO) return
        if (event.packageName != DOUYIN_PKG) return

        val root = rootInActiveWindow ?: return
        // resource-id 混淆同上——评论按钮改为优先按 content-desc 匹配（"评论"/带数字的
        // "评论 N" 朗读文案），resource-id 候选值保留兜底但大概率命中不了。
        val commentBtn = findNodeByContentDescPrefix(root, "评论") ?: findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/iv_comment",
            "com.ss.android.ugc.aweme:id/comment_icon",
            "com.ss.android.ugc.aweme:id/tv_comment_count",
            "com.ss.android.ugc.aweme:id/comment_count",
        )
        if (commentBtn == null) return

        state = State.OPENING_COMMENTS
        commentBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        startCommentsTimeout()
        startExtractionWatchdog()
    }

    private fun startCommentsTimeout() {
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            if (state == State.OPENING_COMMENTS) {
                attemptExtractComments()
            }
        }
    }

    // 真机复现：评论数很多的热门视频(1.1万条评论)会让 attemptExtractComments()
    // 卡住不返回(疑似节点树遍历在这类大型评论列表上耗时异常)，跟
    // startVideoOpenTimeout() 同样的坑——EXTRACTING_COMMENTS 阶段本身没有
    // 兜底，一旦卡住就永久挂起。这个看门狗独立于 attemptExtractComments 的
    // 调用路径，到点了发现还没上报就强制报错收尾（resultReported 一次性闩
    // 保证跟原调用不会重复上报）。
    private fun startExtractionWatchdog() {
        scope.launch {
            delay(EXTRACTION_TIMEOUT_MS)
            if (!resultReported) {
                finishWithError("EXTRACTION_TIMEOUT")
            }
        }
    }

    // ── 7. 提取评论区留言人+留言内容 ─────────────────────────────────────────

    private fun handleCommentsOpened(event: AccessibilityEvent) {
        if (state != State.OPENING_COMMENTS) return
        if (event.packageName != DOUYIN_PKG) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) return
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            attemptExtractComments()
        }
    }

    private fun attemptExtractComments() {
        if (resultReported) return // A2：已上报则不再重复提取/上报
        state = State.EXTRACTING_COMMENTS
        val root = rootInActiveWindow
        if (root == null) {
            finishWithError("NO_COMMENTS_WINDOW")
            return
        }

        val nodes = flattenNodes(root)
        val comments = NodeExtractor.extractComments(nodes)

        if (comments.isEmpty()) {
            // 评论面板可能还未渲染完，稍候重试一次
            scope.launch {
                delay(RandomDelay.sample(RandomDelay.CLICK_MS))
                val retryRoot = rootInActiveWindow ?: run {
                    finishWithError("RETRY_NO_WINDOW"); return@launch
                }
                val retryComments = NodeExtractor.extractComments(flattenNodes(retryRoot))
                reportResult(retryComments)
            }
        } else {
            reportResult(comments)
        }
    }

    private fun reportResult(comments: List<CommentEntry>) {
        if (resultReported) return // A2：一个任务只上报一次
        resultReported = true
        val result = CollectResult(
            ok = comments.isNotEmpty(),
            keyword = currentKeyword,
            comments = comments,
        )
        android.util.Log.i(TAG, "extracted ${comments.size} comments for keyword=$currentKeyword")
        state = State.IDLE
        ScanMutex.busy = false
        onResult?.invoke(result)
        sendResultBroadcast(result)
    }

    private fun finishWithError(code: String) {
        if (resultReported) return // A2：已上报(成功或失败)则不再重复
        resultReported = true
        android.util.Log.w(TAG, "collect error: $code keyword=$currentKeyword")
        val result = CollectResult(ok = false, keyword = currentKeyword, error = code)
        state = State.IDLE
        ScanMutex.busy = false
        onResult?.invoke(result)
        sendResultBroadcast(result)
    }

    private fun sendResultBroadcast(result: CollectResult) {
        // 主路径：同进程直接回调，不依赖系统广播（见 companion.onCollectResult 注释——
        // 真机实测过 sendBroadcast 在这台荣耀设备上不可靠，回调是唯一确认有效的路径）。
        onCollectResult?.invoke(
            currentTaskId,
            result.ok,
            result.comments.map { it.commenterId },
            result.comments.map { it.text },
            result.error,
        )
        // 兜底广播只在回调缺席时才发：AgentService 引入队列状态机后（CollectTaskQueue），
        // 双投递会导致 reportCollectResult 对下一个在跑的 job 提前 markCurrentDone。
        if (!shouldSendFallbackBroadcast(onCollectResult != null)) return
        val intent = Intent(ACTION_COLLECT_RESULT).apply {
            setPackage(packageName)
            putExtra(EXTRA_TASK_ID, currentTaskId)
            putExtra(EXTRA_RESULT_OK, result.ok)
            putExtra(EXTRA_RESULT_COMMENT_IDS, result.comments.map { it.commenterId }.toTypedArray())
            putExtra(EXTRA_RESULT_COMMENT_TEXTS, result.comments.map { it.text }.toTypedArray())
            putExtra(EXTRA_RESULT_ERROR, result.error)
        }
        sendBroadcast(intent)
    }

    // ── 节点树工具 ────────────────────────────────────────────────────────────

    private fun flattenNodes(root: AccessibilityNodeInfo): List<NodeExtractor.NodeInfo> {
        // 真机复现：热门视频(1.1万条评论)的评论区节点树遍历会异常耗时/疑似卡死，
        // 加节点数上限防止在这类大树上无限期占用主线程(与 startExtractionWatchdog
        // 互为兜底：这里防真卡死，watchdog 防"卡住但没完全死"这类情况)。
        val result = mutableListOf<NodeExtractor.NodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < MAX_FLATTEN_NODES) {
            val node = queue.removeFirst()
            visited++
            result.add(NodeExtractor.NodeInfo(
                text = node.text?.toString() ?: "",
                contentDescription = node.contentDescription?.toString() ?: "",
                resourceId = node.viewIdResourceName ?: "",
            ))
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return result
    }

    private fun findNodeByIds(root: AccessibilityNodeInfo, vararg ids: String): AccessibilityNodeInfo? {
        for (id in ids) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            if (list.isNotEmpty()) return list[0]
        }
        return null
    }

    /** 按 content-description 精确匹配（不受 resource-id 混淆影响）。 */
    private fun findNodeByContentDesc(root: AccessibilityNodeInfo, desc: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.contentDescription?.toString() == desc) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /** 按 content-description 前缀匹配（如"评论 123"这种带数字后缀的朗读文案）。 */
    private fun findNodeByContentDescPrefix(root: AccessibilityNodeInfo, prefix: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.contentDescription?.toString()?.startsWith(prefix) == true) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /**
     * 诊断用：把节点树前 limit 个节点的 (className / clickable / desc / text / bounds) 打印到 logcat。
     * 用于现场定位抖音无障碍树是否被折叠、分享按钮 contentDescription 实际文案是什么。
     * tag 标注是哪个阶段（如 "detail" / "panel"），便于 grep。
     */
    private fun dumpNodeDescs(root: AccessibilityNodeInfo?, tag: String, limit: Int = 80) {
        if (root == null) {
            android.util.Log.w(TAG, "DUMP[$tag] root=null")
            return
        }
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        val bounds = Rect()
        var n = 0
        while (queue.isNotEmpty() && n < limit) {
            val node = queue.removeFirst()
            node.getBoundsInScreen(bounds)
            val desc = node.contentDescription?.toString()?.take(40)
            val txt = node.text?.toString()?.take(40)
            if (!desc.isNullOrBlank() || !txt.isNullOrBlank() || node.isClickable) {
                android.util.Log.i(TAG,
                    "DUMP[$tag] #$n cls=${node.className} click=${node.isClickable} " +
                        "b=${bounds.width()}x${bounds.height()} desc=$desc txt=$txt")
                n++
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        android.util.Log.i(TAG, "DUMP[$tag] end printed=$n childCount(root)=${root.childCount}")
    }

    /** 按精确文本匹配（用于 resource-id 混淆、且节点 clickable=false 不支持无障碍点击的按钮）。 */
    private fun findNodeByText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.text?.toString() == text) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /** 用 dispatchGesture 在节点 bounds 中心模拟一次真实触摸点击（绕开 clickable=false 的无障碍点击限制）。 */
    /**
     * 稳健点击：命中节点自身可点击时直接 performAction(ACTION_CLICK)；自身不可点击时
     * （抖音混淆节点，ACTION_CLICK 空操作、且对可点击祖先 performAction 实测也不生效）
     * 退回坐标手势点击命中节点中心。判据见 [mustGestureTap] 的真机根因说明。
     */
    private fun clickNodeRobustly(node: AccessibilityNodeInfo) {
        val chain = ArrayList<AccessibilityNodeInfo>()
        var cur: AccessibilityNodeInfo? = node
        while (cur != null) {
            chain.add(cur)
            cur = cur.parent
        }
        if (mustGestureTap(chain.map { it.isClickable })) {
            tapNodeCenter(node)
        } else {
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
    }

    private fun tapNodeCenter(node: AccessibilityNodeInfo) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.isEmpty) return
        val path = Path().apply { moveTo(bounds.centerX().toFloat(), bounds.centerY().toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        dispatchGesture(gesture, null, null)
    }

    private fun findFirstEditText(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.className?.contains("EditText") == true) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun findFirstVideoCard(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        // 视频卡常见 resource-id 或 clickable 含视频 URL 的节点
        val byId = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/video_card",
            "com.ss.android.ugc.aweme:id/iv_video_cover",
            "com.ss.android.ugc.aweme:id/video_item",
        )
        if (byId != null) return byId

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        val bounds = android.graphics.Rect()
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isClickable) {
                node.getBoundsInScreen(bounds)
                if (bounds.width() > 400 && bounds.height() > 400) return node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    // Stage1：收集多张视频卡（最多 maxCount 张），按尺寸阈值匹配
    private fun findVideoCards(root: AccessibilityNodeInfo, maxCount: Int): List<AccessibilityNodeInfo> {
        val result = mutableListOf<AccessibilityNodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        val bounds = android.graphics.Rect()
        while (queue.isNotEmpty() && result.size < maxCount) {
            val node = queue.removeFirst()
            if (node.isClickable) {
                node.getBoundsInScreen(bounds)
                if (bounds.width() > 400 && bounds.height() > 400) {
                    result.add(node)
                    // 不递归已匹配节点的子树，避免把同一卡片的子节点也加进来
                    continue
                }
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return result
    }

    companion object {
        private const val TAG = "DouyinCollectService"
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"
        private const val RESULTS_SETTLE_MS = 400L
        // state 停留超过该阈值视为流程已死：busy-guard 强制复位而不是拒绝新任务
        private const val STUCK_STATE_RESET_MS = 180_000L
        private const val VIDEO_OPEN_TIMEOUT_MS = 15_000L
        private const val EXTRACTION_TIMEOUT_MS = 20_000L
        private const val MAX_FLATTEN_NODES = 3_000
        const val MAX_VIDEOS_PER_SEARCH = 3  // Stage1 每关键词最多收集视频卡数量
        // Bug C 剪贴板取链：单张卡片全程硬超时 + 各阶段等待预算
        private const val PER_CARD_TIMEOUT_MS = 25_000L
        private const val CLEAR_WAIT_MS = 2_000L
        private const val READ_DELIVER_MS = 4_000L
        private const val LAUNCH_ECHO_TIMEOUT_MS = 1_000L
        private const val LAUNCH_ECHO_POLL_MS = 100L
        private const val PANEL_SETTLE_MS = 300L
        private const val PANEL_MAX_ATTEMPTS = 7

        // Bug C：ShareIngestActivity 收到抖音分享面板的 ACTION_SEND 文案后，经此静态入口投递给
        // 当前采集中的服务实例（同进程，照 onCollectResult 的回调模式，不走系统广播）。
        @Volatile
        private var activeInstance: DouyinCollectService? = null

        /**
         * ShareIngestActivity 读回剪贴板文案后投递；token 校验通过才 complete，防跨卡串号。
         * clipTimestampMs：剪贴板写入时刻（uptimeMillis 时间基），随文案一起带上供服务侧
         * 新鲜度闸判残留旧短链；legacy(ACTION_SEND) 路径用 LEGACY_CLIP_TIMESTAMP_MS 豁免。
         */
        fun deliverShareText(rawText: String?, deliveryToken: Long, clipTimestampMs: Long) {
            val link = ShareLinkExtractor.extract(rawText)
            val inst = activeInstance ?: run {
                android.util.Log.w(TAG, "deliverShareText: no active instance, drop"); return
            }
            val pending = inst.pendingShareCapture ?: run {
                android.util.Log.w(TAG, "deliverShareText: no pending capture, drop link=$link"); return
            }
            if (!ClipboardCaptureGate.acceptDelivery(deliveryToken, pending.first)) {
                android.util.Log.w(TAG, "deliverShareText: token mismatch d=$deliveryToken e=${pending.first}, drop"); return
            }
            android.util.Log.i(TAG, "deliverShareText: delivering link=$link token=$deliveryToken clipTs=$clipTimestampMs")
            pending.second.complete(ShareCapturePayload(link, clipTimestampMs))
        }

        /** clear_clipboard 模式完成回投。 */
        fun deliverClearDone(deliveryToken: Long) {
            val inst = activeInstance ?: return
            val pending = inst.pendingClearDone ?: return
            if (!ClipboardCaptureGate.acceptDelivery(deliveryToken, pending.first)) return
            pending.second.complete(true)
        }

        /** Activity onCreate 时记回执。 */
        fun noteIngestLaunched(token: Long) {
            activeInstance?.ingestLaunchedToken = token
        }

        const val ACTION_COLLECT_TASK = "com.zenithjoy.agent.COLLECT_TASK"
        const val ACTION_COLLECT_RESULT = "com.zenithjoy.agent.COLLECT_RESULT"

        // Bug C：旧 ACTION_SEND 路径的 token 豁免值，单一来源 ClipboardCaptureGate，此处仅转发供 Activity 引用
        const val LEGACY_ACTION_SEND_TOKEN = ClipboardCaptureGate.LEGACY_ACTION_SEND_TOKEN

        // 任务模式 extra
        const val EXTRA_MODE = "mode"
        const val MODE_STAGE1 = "stage1"
        const val MODE_STAGE2 = "stage2"
        const val EXTRA_VIDEO_URL = "video_url"
        const val EXTRA_VIDEO_ID = "video_id"

        // Stage1 视频卡回调（同进程，不走广播）
        @Volatile
        var onVideoCardResult: ((taskId: String, keyword: String, videos: List<VideoCardInfo>, error: String) -> Unit)? = null

        @Volatile
        var onCollectResult: ((taskId: String, ok: Boolean, commentIds: List<String>, commentTexts: List<String>, error: String) -> Unit)? = null

        // busy 拒绝回执（同进程直接调用）：真机复现(2026-07-10) busy 静默丢广播会让
        // AgentService 队列的 currentJob 永不清除 → 永久死锁。拒绝必须显式通知派发方重试。
        @Volatile
        var onTaskRejected: ((taskId: String) -> Unit)? = null

        // dispatch 正向确认（同进程直接调用）：广播可能进虚空（无障碍服务未 connected
        // 时 receiver 未注册），届时既无 onReceive 也无拒绝回执，派发方看门狗只能靠
        // "超时未 ack"判定投递失败并重试。
        @Volatile
        var onTaskAccepted: ((taskId: String) -> Unit)? = null
        const val EXTRA_KEYWORD = "keyword"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_RESULT_OK = "ok"
        const val EXTRA_RESULT_COMMENT_IDS = "comment_ids"
        const val EXTRA_RESULT_COMMENT_TEXTS = "comment_texts"
        const val EXTRA_RESULT_ERROR = "error"

        internal fun isResultEventDebounced(triggeredAtMs: Long, nowMs: Long, settleMs: Long): Boolean {
            return nowMs - triggeredAtMs <= settleMs
        }

        internal fun shouldEnterSubmitting(currentState: State): Boolean {
            return currentState == State.TYPING_KEYWORD
        }

        internal fun shouldRetryWithTabSwitch(alreadyTriedTabSwitch: Boolean): Boolean {
            return !alreadyTriedTabSwitch
        }

        // 回调（同进程直接调用）是主投递路径；兜底广播只在回调缺席时才发，
        // 否则回调+广播双投递会把队列里下一个在跑的 job 提前 markCurrentDone。
        internal fun shouldSendFallbackBroadcast(callbackRegistered: Boolean): Boolean {
            return !callbackRegistered
        }

        // 非 IDLE 状态停留超过阈值 = 流程已死（协程死亡/事件流断），busy-guard 应
        // 强制复位接受新任务而不是拒绝。
        internal fun isBusyStateStale(stateChangedAtMs: Long, nowMs: Long, thresholdMs: Long): Boolean {
            return nowMs - stateChangedAtMs > thresholdMs
        }

        /**
         * 判定是否必须退回坐标手势点击（dispatchGesture）而非 performAction(ACTION_CLICK)。
         *
         * 真机实测（Douyin 39.5.0）两处实证：
         *   ① 搜索入口 "搜索" TextView（id 混淆 4ty）：整条祖先链 clickable 全 false → NO_SEARCH_INPUT。
         *   ② 搜索结果 "综合"/"视频" 标签：命中的 Button 自身 clickable=false，祖先 ActionBar$Tab
         *      clickable=true，但对该祖先 performAction(ACTION_CLICK) 实测【不切标签】，只有对命中
         *      节点中心坐标手势才生效（uiautomator dump + input tap 实证）→ 否则停在空"主页" → SEARCH_TIMEOUT。
         *
         * Android performAction(ACTION_CLICK) 只作用于被调用的节点、不冒泡到祖先；findNodeByText/Id
         * 命中的往往是内层不可点击元素。②证明"链上有可点击祖先"不足以让 ACTION_CLICK 生效，
         * 故判据取【命中节点自身是否可点击】：自身不可点击就必须坐标手势模拟真实触摸。
         *
         * @param clickableChain 目标节点到根，每一级的 isClickable 值（index 0 = 命中节点自身）。
         * @return true = 命中节点自身不可点击（或空链），ACTION_CLICK 点不动，必须坐标手势。
         */
        internal fun mustGestureTap(clickableChain: List<Boolean>): Boolean =
            clickableChain.firstOrNull() != true

        // Stage1 派发（关键词搜索+收集视频卡）
        fun dispatchTask(context: Context, keyword: String, taskId: String) {
            val intent = Intent(ACTION_COLLECT_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_MODE, MODE_STAGE1)
                putExtra(EXTRA_KEYWORD, keyword)
                putExtra(EXTRA_TASK_ID, taskId)
            }
            context.sendBroadcast(intent)
            android.util.Log.i(TAG, "dispatchTask(stage1) keyword=$keyword taskId=$taskId")
        }

        // Stage2 派发（按视频 URL 进评论区抓评论）
        fun dispatchStage2Task(context: Context, videoUrl: String, videoId: String, taskId: String) {
            val intent = Intent(ACTION_COLLECT_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_MODE, MODE_STAGE2)
                putExtra(EXTRA_VIDEO_URL, videoUrl)
                putExtra(EXTRA_VIDEO_ID, videoId)
                putExtra(EXTRA_TASK_ID, taskId)
            }
            context.sendBroadcast(intent)
            android.util.Log.i(TAG, "dispatchTask(stage2) videoId=$videoId taskId=$taskId")
        }
    }

    // Stage1 视频卡信息（用于 onVideoCardResult 回调）。
    // Bug C 修复后 videoId 恒为空——真实 video_id 由服务端从 shareUrl 跟随 302 解析；
    // 本地只负责经 share-intent 拿到 v.douyin.com 短链填 shareUrl。
    data class VideoCardInfo(
        val videoId: String,
        val keyword: String,
        val title: String? = null,
        val shareUrl: String? = null,
    )

    // 剪贴板读回载荷：短链文案 + clip 写入时间戳（uptimeMillis 时间基，供新鲜度闸判残留串号）。
    data class ShareCapturePayload(
        val link: String?,
        val clipTimestampMs: Long,
    )
}
