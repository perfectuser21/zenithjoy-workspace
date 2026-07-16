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
    // 快照纪律 token（SnapshotDiscipline）：每次跨窗口点击后必须推进，禁止复用点击前的 root。
    // Seg3 抖音号回填（点头像进主页→BACK 回面板）逐条跨窗口，是该纪律的重灾区。
    private var fetchToken = 0
    // A2 重入闸：评论面板每个无障碍事件都会 launch 一个提取协程，state 切走前已排队多个，
    // 导致 reportResult 被调 7~12 次、onResult 重复上报。用一次性闩保证一个任务只上报一次。
    @Volatile private var resultReported = false
    // Stage1 单飞闩：collectVideoCards 一旦启动即置位，禁止同一 task 内再启动第二个采集协程
    // 或再触发搜索（triggerSearch 二次触发会重置 state → 并发采集 → UIA 树互相 recycle 塌缩 →
    // ALL_SHARE_FAILED）。仅在 startCollect（新 task）复位。判据见 [mayStartStage1Work]。
    @Volatile private var collectionLaunched = false
    // 真机复现(2026-07-10)：抖音搜索默认落在"主页"标签（找账号主页用的，天然没有视频卡片），
    // 真实视频内容在"综合"/"视频"标签。首次超时先尝试切标签重试一次，避免误判 SEARCH_TIMEOUT。
    private var triedTabSwitch = false
    // 看门狗重入根治(真机复现 2026-07-11 xian-rog 荣耀)：startSearchResultTimeout() 每次调用
    // 都 new 一个协程，旧协程从不 cancel。tab 切换后 67ms 内又触发一次误判 SEARCH_TIMEOUT，
    // 正是某个更早创建、还没到期的旧看门狗读到被别的协程改过的 triedTabSwitch 直接判定失败——
    // 这时刚点下去的 tab 切换手势其实还没来得及生效。用单调递增 generation 给每个看门狗发号，
    // 到期时只有仍是最新 generation 的那个才有权处理，见 [shouldHonorTimeoutFiring]。
    private var timeoutGeneration = 0

    // Bug C 剪贴板路线：等待 ShareIngestActivity 读回的短链，带 token 防跨卡串号。
    // 载荷携带 (短链文案, clip 写入时间戳)——时间戳供服务侧新鲜度闸判残留旧短链串号。
    @Volatile private var pendingShareCapture: Pair<Long, CompletableDeferred<ShareCapturePayload?>>? = null
    @Volatile private var pendingClearDone: Pair<Long, CompletableDeferred<Boolean>>? = null
    // 拉起回执：Activity onCreate 时置为其 token，服务侧 consume 判定拉起成功
    @Volatile private var ingestLaunchedToken: Long = Long.MIN_VALUE
    private var shareTokenSeq = 0L
    private val seenShareUrls = mutableSetOf<String>()

    internal enum class ResultsAction { WAIT_FOR_TAB_SWITCH, COLLECT, IGNORE }

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
        collectionLaunched = false
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
            // 必须叠加 CLEAR_TASK：仅 NEW_TASK 会 resume 到上次采集残留的 DetailActivity
            // （取分享链会点进视频详情页，任务中途死留栈）→ 在详情页跑搜索 → SEARCH_TIMEOUT。
            // CLEAR_TASK 强制清栈从 launcher 全新启动回干净首页 feed（不动登录态，真机实证）。
            launchIntent.flags = stage1LaunchFlags(launchIntent.flags)
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
            android.util.Log.i(TAG, "openSearchBar: searchBtn=${searchBtn != null}")
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
        // 单飞闩：采集已启动后禁止再触发搜索。二次 triggerSearch 会把 state 重置回
        // WAITING_SEARCH_RESULTS，放行第二个搜索结果事件并发启动 collectVideoCards（真机
        // e8597732 ALL_SHARE_FAILED 根因）。从源头堵住重置，与 handleSearchResults 同一闩。
        if (!mayStartStage1Work(collectionLaunched)) {
            android.util.Log.w(TAG, "triggerSearch 忽略：采集已在飞行中，不再重置 state 重复搜索")
            return
        }
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
            confirmBtn != null -> {
                android.util.Log.i(TAG, "triggerSearch: branch=confirmBtn(ACTION_CLICK)")
                confirmBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            searchTextNode != null -> {
                android.util.Log.i(TAG, "triggerSearch: branch=searchTextNode(tapCenter)")
                tapNodeCenter(searchTextNode)
            }
            else -> {
                android.util.Log.i(TAG, "triggerSearch: branch=ime_enter_fallback")
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
        val myGeneration = ++timeoutGeneration
        scope.launch {
            val found = withTimeoutOrNull(10_000L) {
                while (state == State.WAITING_SEARCH_RESULTS) delay(300)
                true
            }
            if (!shouldHonorTimeoutFiring(myGeneration, timeoutGeneration)) return@launch
            if (found == null && state == State.WAITING_SEARCH_RESULTS) {
                // 真机复现：抖音搜索默认落在"主页"标签（空，找账号用），视频内容在"综合"/
                // "视频"标签。先尝试切标签重试一次，不是每次超时都直接判失败。
                val diagRoot = rootInActiveWindow
                android.util.Log.i(TAG, "timeout fired: triedTab=$triedTabSwitch pkg=${diagRoot?.packageName}" +
                    " 综合=${diagRoot?.let { findNodeByText(it, "综合") != null }}" +
                    " 视频=${diagRoot?.let { findNodeByText(it, "视频") != null }}" +
                    " editText=${diagRoot?.let { findFirstEditText(it) != null }}")
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

    /**
     * 找"视频"标签并点击切换，退回"综合"（比空白"主页"tab 强，但会混直播间，仅兜底）。
     * 优先级：视频 > 综合——目标是拿到纯视频结果，综合 tab 直播/视频/用户混排是
     * ALL_SHARE_FAILED 根因（真机复现 2026-07-11），只在找不到"视频"标签时才退而求其次。
     */
    private fun trySwitchToVideoTab(): Boolean {
        val root = rootInActiveWindow ?: return false
        val tab = findNodeByText(root, "视频") ?: findNodeByText(root, "综合") ?: run {
            android.util.Log.i(TAG, "trySwitchToVideoTab: no 视频/综合 tab node found")
            return false
        }
        // 真机实测(Douyin 39.5.0)：命中的"综合"Button clickable=false，对其祖先 ActionBar$Tab
        // performAction(ACTION_CLICK) 不切标签，只有坐标手势有效。走 clickNodeRobustly 统一判据。
        val b = android.graphics.Rect().also { tab.getBoundsInScreen(it) }
        android.util.Log.i(TAG, "trySwitchToVideoTab: tapping tab bounds=$b clickable=${tab.isClickable}")
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
            android.util.Log.i(TAG, "handleSearchResults: pkg=${root.packageName} cards=${videoCards.size}")
            // 根治 ALL_SHARE_FAILED（真机复现 2026-07-11）：搜索结果默认落"综合"tab，直播/视频/
            // 用户混排且直播常排前，哪怕这批"卡片"非空也可能混了直播间——点开进直播间没有普通
            // 视频分享取链路径，全卡失败。哪怕已经找到卡片，只要本 task 还没切过一次"视频"tab，
            // 也先切标签、忽略这批结果，等标签切换后的下一个结果事件再采（那才是"视频"tab 的干净结果）。
            when (decideStage1ResultsAction(videoCards.isNotEmpty(), triedTabSwitch)) {
                ResultsAction.IGNORE -> return
                ResultsAction.WAIT_FOR_TAB_SWITCH -> {
                    triedTabSwitch = true
                    if (trySwitchToVideoTab()) {
                        android.util.Log.i(TAG, "handleSearchResults: 首次结果，先切「视频」tab 再采（避免撞直播间）")
                        searchTriggeredAtMs = android.os.SystemClock.elapsedRealtime()
                        // 看门狗重入根治：必须重启看门狗（bump generation），否则原 triggerSearch()
                        // 启动的旧看门狗仍会按创建时刻起算的 10s 预算独立到期，读到刚置位的
                        // triedTabSwitch=true 直接误判 SEARCH_TIMEOUT，此时 tab 切换手势还没生效。
                        startSearchResultTimeout()
                        return
                    }
                    // 找不到标签节点（罕见，如已就在纯净列表页）：不再等切换，直接按本批结果采集。
                }
                ResultsAction.COLLECT -> {}
            }
            if (videoCards.isEmpty()) return
            // 单飞闩：triggerSearch 二次触发会把 state 重置回 WAITING_SEARCH_RESULTS，让第二个
            // 搜索结果事件再次走到这里并发启动第二个 collectVideoCards → 两协程互相 recycle 抖音
            // UIA 树 → ALL_SHARE_FAILED。state 守卫挡不住(已被重置)，用单调闩确保一 task 只采集一次。
            if (!mayStartStage1Work(collectionLaunched)) {
                android.util.Log.w(TAG,
                    "collectVideoCards 已在飞行中，忽略重复搜索结果事件（防并发采集 recycle UIA 树）")
                return
            }
            collectionLaunched = true
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
            // 二次防线（真机根因 2026-07-13）：点开前先分类。广告/直播卡点开抓不到 v.douyin.com
            // 分享链，旧逻辑把它们计入 consecutiveFailures → 连续 2 张广告就 abort 整轮。改为
            // AD/LIVE 直接跳过、不点开、绝不计 failure（专门 tab 已天然过滤，这里兜偶入的广告）。
            val kind = classifyCardAtIndex(index)
            if (CardClassifier.shouldSkip(kind)) {
                android.util.Log.i(TAG, "Stage1 card#$index classified=$kind — skip（不点开/不计failure）")
                continue
            }
            val shareUrl = captureShareUrlForCard(index)
            pendingShareCapture = null
            pendingClearDone = null
            if (shareUrl != null) {
                collected.add(VideoCardInfo(videoId = "", keyword = currentKeyword, shareUrl = shareUrl))
                seenShareUrls.add(shareUrl)
                consecutiveFailures = 0
                android.util.Log.i(TAG, "Stage1 card#$index share_url captured: $shareUrl")
            } else if (CardClassifier.shouldCountAsCollectFailure(kind, captureSucceeded = false)) {
                consecutiveFailures++
                android.util.Log.w(TAG, "Stage1 card#$index($kind) share_url capture failed ($consecutiveFailures)")
                if (consecutiveFailures >= MAX_CONSECUTIVE_CONTENT_FAILURES) {
                    android.util.Log.w(TAG, "Stage1 aborting: $consecutiveFailures 连续内容卡取链失败")
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

    // 点开前给第 index 张卡分类（读其子树 text/desc → CardClassifier）。广告/直播卡不点开、
    // 不取链、不计 failure，根治"连续广告 → consecutiveFailures>=2 → abort 整轮"（真机 2026-07-13）。
    // 抓不到卡时防御性返回 CONTENT（交给 captureShareUrlForCard 走正常失败路径，不误吞）。
    private fun classifyCardAtIndex(index: Int): CardClassifier.CardKind {
        val root = rootInActiveWindow ?: return CardClassifier.CardKind.CONTENT
        val card = findVideoCards(root, MAX_VIDEOS_PER_SEARCH).getOrNull(index)
            ?: return CardClassifier.CardKind.CONTENT
        return CardClassifier.classify(collectNodeTexts(card), emptyList())
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

            // 2. 点分享（只取在屏可见的分享按钮，避开翻页器里相邻视频屏幕外的同名按钮）
            val shareBtn = findVisibleNodeByContentDescPrefix(detailRoot, "分享")
                ?: findVisibleNodeByContentDescPrefix(detailRoot, "转发")
                ?: run {
                    android.util.Log.w(TAG,
                        "capture abort card#$index: STEP2_no_visible_share_btn (detailChild=${detailRoot.childCount})")
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

    // 从视频详情/分享面板 BACK 回搜索结果页。判据加强（真机 2026-07-13 19:52 xian-rog）：
    // 不能只看"抖音包内有一张卡"——采完 card#0 点开进的全屏视频播放页那张 1200×2504 大卡也满足，
    // 会误判"已回列表"停在播放页 → 重抓 findVideoCards 只 found=1 → 下一张卡 STEP1_no_card → abort。
    // 必须是【搜索结果多卡列表】：≥2 张卡（双列）或带搜索 tab 栏（综合/视频）。最多按 MAX_BACK_TO_RESULTS 次。
    private suspend fun navigateBackToResults() {
        repeat(MAX_BACK_TO_RESULTS) {
            val root = rootInActiveWindow
            if (root != null && root.packageName == DOUYIN_PKG &&
                isBackAtResultList(findVideoCards(root, 2).size, hasSearchTabBar(root))) {
                return
            }
            performGlobalAction(GLOBAL_ACTION_BACK)
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
        }
    }

    // 搜索结果页顶部有"综合/视频/图文/直播"tab 栏；全屏视频播放页没有。回到列表的强锚点之一。
    private fun hasSearchTabBar(root: AccessibilityNodeInfo): Boolean =
        findNodeByText(root, "综合") != null || findNodeByText(root, "视频") != null

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
            // 检查和转移必须在同一次协程恢复内同步完成（中间不能有 suspend 点），
            // 否则 handleCommentsOpened 的事件驱动路径可能在两者之间插入执行。
            if (mayScheduleCommentExtraction(state)) {
                state = State.EXTRACTING_COMMENTS
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
        if (!mayScheduleCommentExtraction(state)) return
        if (event.packageName != DOUYIN_PKG) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) return
        // 真机复现：评论面板展开期间会连续打出多条 WINDOW_STATE_CHANGED/
        // WINDOW_CONTENT_CHANGED 事件。真正的状态转移必须在这里同步完成（检查和
        // 转移之间不能有 suspend 点），否则每一条事件都会在第一个协程真正执行
        // 到 attemptExtractComments() 之前各自通过 state == OPENING_COMMENTS
        // 的判断，各自 schedule 一次 attemptExtractComments()，最终并发跑出
        // 15+ 次重复评论提取（真机 logcat："enriched douyinId 0/1 leads" 3 秒内
        // 重复 15+ 次），互相 recycle 对方的 AccessibilityNodeInfo 树。
        state = State.EXTRACTING_COMMENTS
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            attemptExtractComments()
        }
    }

    private fun attemptExtractComments() {
        if (resultReported) return // A2：已上报则不再重复提取/上报
        state = State.EXTRACTING_COMMENTS
        scope.launch {
            val (sawWindow, comments) = pollForComments()
            if (!sawWindow) {
                finishWithError("NO_COMMENTS_WINDOW")
                return@launch
            }
            reportResult(enrichCommentsWithDouyinId(comments))
        }
    }

    /**
     * 评论列表懒加载/虚拟化轮询（真机复现 2026-07-16）：评论面板刚打开时常只有容器，
     * 评论 item 要再等一拍才渲染出来。旧实现只重试一次、间隔仅 CLICK_MS(0.8-1.8s)，
     * 三条真机视频（各自几十上百条真实评论）连续复现 extracted 0 comments——面板明明
     * 秒开有内容，只是自动化抓取的那一刻还没渲染够。轮询到有结果就立即返回，不占满
     * 全部预算；全程拿不到窗口才是真的 NO_COMMENTS_WINDOW。
     */
    private suspend fun pollForComments(): Pair<Boolean, List<CommentEntry>> {
        var sawWindow = false
        repeat(COMMENT_LIST_POLL_ATTEMPTS) { attempt ->
            val root = rootInActiveWindow
            if (root != null) {
                sawWindow = true
                val comments = NodeExtractor.extractComments(flattenNodes(root))
                if (comments.isNotEmpty()) return true to comments
            }
            if (!isFinalCommentPollAttempt(attempt, COMMENT_LIST_POLL_ATTEMPTS)) {
                delay(COMMENT_LIST_POLL_MS)
            }
        }
        return sawWindow to emptyList()
    }

    // ── 7.5 抖音号回填（Seg3 方案 B′）─────────────────────────────────────────
    //
    // 光有昵称没用：派单段要把【抖音号】发给设备做精确搜索定位（DouyinDmOutreachService
    // 拿到的字段就是当抖音号搜的）。这里逐条点评论人头像进主页，把真实抖音号读出来回填。
    //
    // 真机证据（2026-07-15 xian-rog，2/2 评论人复现）：
    //   avatar content-desc="<昵称>的头像"、clickable=true → 点它进全屏 UserProfileActivity
    //   → 该页一次 dump 即含 text="抖音号：1689210742" → BACK ×1 回评论面板且滚动位置保留。

    /**
     * 只 enrich 前 [MAX_ENRICH_LEADS] 条（第一刀口径），其余原样保留 douyinId=null——
     * 不丢条：读不到号的评论仍是有效 lead 素材，只是暂时派不出私信。
     */
    private suspend fun enrichCommentsWithDouyinId(comments: List<CommentEntry>): List<CommentEntry> {
        if (comments.isEmpty()) return comments
        val head = comments.take(MAX_ENRICH_LEADS)
        val tail = comments.drop(MAX_ENRICH_LEADS)
        val enriched = enrichEntries(
            head,
            onError = { nickname, e ->
                android.util.Log.w(TAG, "enrich douyinId failed for $nickname: ${e.message}")
            },
        ) { nickname ->
            // per-lead 硬超时：卡住就跳过该条（douyinId=null），绝不拖垮整轮。
            withTimeoutOrNull(PER_LEAD_ENRICH_TIMEOUT_MS) { resolveDouyinIdForCommenter(nickname) }
        }
        android.util.Log.i(
            TAG,
            "enriched douyinId ${enriched.count { it.douyinId != null }}/${head.size} leads",
        )
        return enriched + tail
    }

    /**
     * 单条：点头像 → 等主页 → 读抖音号 → BACK 回评论面板。
     *
     * **每次都重抓 root、按 content-desc 重新定位 avatar**，绝不复用上一轮的节点句柄：
     * 跨窗口（面板→主页→面板）后旧 AccessibilityNodeInfo 必 stale，遍历它只会得到空
     * （captureShareUrlForCard 血泪注释，见本文件 :625-632）；重新定位同时顺带绕开
     * 评论列表虚拟化回收后的 index 漂移。
     */
    private suspend fun resolveDouyinIdForCommenter(nickname: String): String? {
        val panelRoot = awaitRootInActiveWindow() ?: return null
        val avatar = findNodeByContentDesc(panelRoot, avatarContentDesc(nickname)) ?: run {
            android.util.Log.d(TAG, "avatar not found for $nickname (可能已滚出可视区)")
            return null
        }

        val beforeTapToken = fetchToken
        tapNodeCenter(avatar)
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        // 快照纪律：点击跨窗口后必须重新抓取，禁止复用点击前的 root。
        fetchToken = SnapshotDiscipline.nextFetchToken(beforeTapToken)
        SnapshotDiscipline.requireFresh(beforeTapToken, fetchToken)

        val id = awaitDouyinIdOnProfile()
        // 无论读没读到都必须回面板，否则下一条定位不到 avatar，整轮连环失败。
        navigateBackToComments()
        return id
    }

    /** 轮询等主页渲染出 "抖音号：" 行（首屏懒加载，未必在落地瞬间就进无障碍树）。 */
    private suspend fun awaitDouyinIdOnProfile(
        attempts: Int = PROFILE_ID_ATTEMPTS,
        intervalMs: Long = PROFILE_ID_POLL_MS,
    ): String? {
        repeat(attempts) {
            rootInActiveWindow?.let { root ->
                DouyinDmOutreachService.extractDouyinId(collectNodeTexts(root))?.let { return it }
            }
            delay(intervalMs)
        }
        return null
    }

    /**
     * 从主页 BACK 回评论面板。判据照 [navigateBackToResults] 的模式——用【只有目标页才有】
     * 的内容锚点确认真落地，不是按一下就假设到了。见 [isBackAtCommentPanel] 注释。
     */
    private suspend fun navigateBackToComments() {
        repeat(MAX_BACK_TO_COMMENTS) {
            val root = rootInActiveWindow
            if (root != null && root.packageName == DOUYIN_PKG &&
                isBackAtCommentPanel(countAvatarNodes(root), hasDouyinIdLine(root))
            ) {
                return
            }
            performGlobalAction(GLOBAL_ACTION_BACK)
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
        }
        android.util.Log.w(TAG, "navigateBackToComments: 按满 $MAX_BACK_TO_COMMENTS 次仍未确认回到评论面板")
    }

    private fun countAvatarNodes(root: AccessibilityNodeInfo): Int =
        root.findAccessibilityNodeInfosByViewId("$DOUYIN_PKG:id/avatar")?.size ?: 0

    /** 主页独有的 "抖音号：" 行是否还在树上（在 = 还没退出主页）。 */
    private fun hasDouyinIdLine(root: AccessibilityNodeInfo): Boolean =
        DouyinDmOutreachService.extractDouyinId(collectNodeTexts(root)) != null

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
            result.comments.map { it.douyinId ?: "" },
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
            putExtra(EXTRA_RESULT_DOUYIN_IDS, result.comments.map { it.douyinId ?: "" }.toTypedArray())
            putExtra(EXTRA_RESULT_ERROR, result.error)
        }
        sendBroadcast(intent)
    }

    // ── 节点树工具 ────────────────────────────────────────────────────────────

    private fun flattenNodes(root: AccessibilityNodeInfo): List<NodeExtractor.NodeInfo> {
        // 真机复现：热门视频(1.1万条评论)的评论区节点树遍历会异常耗时/疑似卡死，
        // 加节点数上限防止在这类大树上无限期占用主线程(与 startExtractionWatchdog
        // 互为兜底：这里防真卡死，watchdog 防"卡住但没完全死"这类情况)。
        //
        // DFS 前序而非 BFS：同一条评论 item 的 avatar→title→[eyo]→content 是同一容器节点
        // 的连续子节点，BFS 按层展开会把它们和其他评论的同层节点交错，打乱
        // NodeExtractor.extractComments 依赖的 avatar 锚定切段（见 NodeTreeFlattener 注释）。
        val accessibilityNodes = NodeTreeFlattener.flattenDfs(root, MAX_FLATTEN_NODES) { node ->
            (0 until node.childCount).mapNotNull { node.getChild(it) }
        }
        return accessibilityNodes.map { node ->
            NodeExtractor.NodeInfo(
                text = node.text?.toString() ?: "",
                contentDescription = node.contentDescription?.toString() ?: "",
                resourceId = node.viewIdResourceName ?: "",
            )
        }
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
     * 按 contentDesc 前缀找节点，但只返回【在屏可见】的那个（真机根因 2026-07-14）：
     * 抖音详情页竖向翻页器的无障碍树含相邻视频（屏幕外）的同名按钮，其 bounds 为空矩形
     * (bottom<top) 或超屏。BFS 取首个会命中屏幕外节点 → tapNodeCenter 因 bounds.isEmpty
     * 静默跳过 → 分享面板不弹 → 取链失败。这里收集全部候选，交由纯逻辑 pickVisibleShareButtonIndex
     * 选在屏那个；全不在屏返回 null（不点，避免空点白耗一张卡）。
     */
    private fun findVisibleNodeByContentDescPrefix(root: AccessibilityNodeInfo, prefix: String): AccessibilityNodeInfo? {
        val matches = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.contentDescription?.toString()?.startsWith(prefix) == true) matches.add(node)
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        if (matches.isEmpty()) return null
        val rect = Rect()
        val boxes = matches.map {
            it.getBoundsInScreen(rect)
            ClipboardCaptureGate.NodeBox(rect.left, rect.top, rect.right, rect.bottom)
        }
        val idx = ClipboardCaptureGate.pickVisibleShareButtonIndex(
            boxes, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels
        )
        return if (idx >= 0) matches[idx] else null
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
        // （internal：computeExtractionTimeoutMs 的上界守卫要断言看门狗早于它触发）
        internal const val STUCK_STATE_RESET_MS = 180_000L
        private const val VIDEO_OPEN_TIMEOUT_MS = 15_000L

        // ── Seg3 抖音号回填（enrich）预算 ─────────────────────────────────────
        //
        // 单条 lead 的往返 = 点头像 → 等 UserProfileActivity 渲染 → 读 "抖音号：" 行 → BACK 回面板。
        // 真机(2026-07-15 xian-rog)单条顺畅时约 3-5s；20s 是【硬超时上界】不是期望值，留足
        // 主页首屏懒加载 + BACK 多跳的余量。取 20s 的依据：单卡取链 PER_CARD_TIMEOUT_MS=25s
        // 是"分享面板→剪贴板→回列表"的预算，enrich 往返比它轻（不碰剪贴板/不等 ShareIngest），
        // 故取比它小一档；withTimeoutOrNull 到点即跳过该条（douyinId=null），不阻塞整轮。
        internal const val PER_LEAD_ENRICH_TIMEOUT_MS = 20_000L
        // 每轮最多 enrich 几条 lead（对齐 Seg3 每视频抓 5 条评论的第一刀口径）。
        internal const val MAX_ENRICH_LEADS = 5
        // 原提取预算（点评论按钮→评论面板渲染→遍历节点树上报），enrich 之外的部分。
        private const val BASE_EXTRACTION_TIMEOUT_MS = 20_000L

        /**
         * 提取阶段看门狗预算。**必须随 enrich 一起调大，否则 enrich 一上线就整轮假失败**：
         * 旧值恒为 20s（只够裸提取），而 5 条 lead 的进主页往返最坏 5×20s=100s，
         * startExtractionWatchdog 会在 enrich 还没跑完时就 finishWithError("EXTRACTION_TIMEOUT")。
         *
         * = 基础提取预算 + maxLeads × 单条 lead 硬超时上界。默认 20s + 5×20s = 120s。
         * 上界约束：必须 < STUCK_STATE_RESET_MS(180s)，否则 busy-guard 先把 state 强制复位，
         * 看门狗的 finishWithError 落空 → 任务永远收不到终态（老坑，见 startVideoOpenTimeout 注释）。
         * 120s < 180s，留 60s 余量。
         */
        internal fun computeExtractionTimeoutMs(
            maxLeads: Int = MAX_ENRICH_LEADS,
            perLeadMs: Long = PER_LEAD_ENRICH_TIMEOUT_MS,
            baseMs: Long = BASE_EXTRACTION_TIMEOUT_MS,
        ): Long = baseMs + maxLeads * perLeadMs

        private val EXTRACTION_TIMEOUT_MS = computeExtractionTimeoutMs()

        /**
         * 评论 avatar 的 content-desc 拼法（真机 2026-07-15 xian-rog 实证：
         * resource-id=".../avatar"、content-desc="<昵称>的头像"、clickable=true、有 bounds）。
         * 每条 lead 都按昵称【重新】定位 avatar——绝不跨 BACK 复用旧 handle（见 enrichEntries 注释）。
         */
        internal fun avatarContentDesc(nickname: String): String = "${nickname}的头像"

        /**
         * enrich 后 BACK 的落点判据（照 [isBackAtResultList] 的模式：用【只有目标页才有】的内容锚点）。
         *
         * 教训同源：navigateBackToResults 旧判据"抖音包内有一张卡"太弱，全屏播放页也满足 → 误判
         * "已回列表"→ 停止 BACK → 后续全错位。这里同理：主页自己也有 avatar 节点，光看 avatar 会
         * 误判"已回面板"。"抖音号：" 行是主页【独有】的强判别（评论面板永远没有），必须它消失
         * 且树上有 avatar 才算真回到评论面板。
         */
        internal fun isBackAtCommentPanel(avatarCount: Int, hasDouyinIdLine: Boolean): Boolean =
            avatarCount >= 1 && !hasDouyinIdLine

        /**
         * enrich 编排核心（与 UIA 解耦，便于单测锁死铁律；真机动作由 [resolve] 注入）。
         *
         * [resolve] 入参【只有昵称】——这是"avatar handle 绝不跨 BACK 复用"在契约层面的体现：
         * 每条都必须重抓 root、按 content-desc 重新定位。跨窗口后旧节点 stale → 遍历为空 →
         * 整任务假失败（captureShareUrlForCard 血泪注释，见本文件 :625-632）；重新定位同时
         * 顺带绕开列表虚拟化后的 index 漂移。
         *
         * 铁律：单条取不到（null/空白/抛异常）→ 该条 douyinId=null，**绝不造假 id**，
         * 且不丢条、不牵连其它条、不炸整轮（#1306「宁可空，不可猜」）。
         *
         * [onError] 由调用方注入（生产侧传 android.util.Log.w）——本函数刻意不直接碰
         * android.util.Log，好让它在 JVM 单测里可跑（本模块没开 unitTests.returnDefaultValues，
         * 直接调 Log 会抛 "not mocked" RuntimeException）。吞异常必须留痕，不许静默。
         */
        internal suspend fun enrichEntries(
            entries: List<CommentEntry>,
            onError: (nickname: String, e: Exception) -> Unit = { _, _ -> },
            resolve: suspend (nickname: String) -> String?,
        ): List<CommentEntry> = entries.map { entry ->
            val id = try {
                resolve(entry.commenterId)?.trim()?.takeIf { it.isNotEmpty() }
            } catch (e: Exception) {
                // 单条炸不许炸整轮——留痕、该条留 null、继续下一条。
                onError(entry.commenterId, e)
                null
            }
            entry.copy(douyinId = id)
        }
        private const val MAX_FLATTEN_NODES = 3_000
        const val MAX_VIDEOS_PER_SEARCH = 3  // Stage1 每关键词最多收集视频卡数量
        // abort 阈值：连续多少张【内容卡】取链失败才放弃整轮。广告/直播跳过不计入（真机 2026-07-13）。
        private const val MAX_CONSECUTIVE_CONTENT_FAILURES = 2
        // navigateBackToResults 最多按几次 BACK 回搜索结果列表（真机：分享面板→播放页→列表可能 ≥2 跳）。
        private const val MAX_BACK_TO_RESULTS = 5
        // navigateBackToComments 最多按几次 BACK 回评论面板。真机实证 BACK ×1 即回（主页是单层全屏
        // Activity），留 3 次余量应对主页上误触开的二级页（如作品详情），比回搜索列表那条路浅。
        private const val MAX_BACK_TO_COMMENTS = 3
        // 主页 "抖音号：" 行轮询预算：8 × 400ms = 3.2s，落在单条 lead 20s 硬超时之内。
        private const val PROFILE_ID_ATTEMPTS = 8
        private const val PROFILE_ID_POLL_MS = 400L

        // 评论列表轮询预算：真机复现(2026-07-16)——评论面板打开后列表项是懒加载/虚拟化的，
        // 首次到达 EXTRACTING_COMMENTS 时常只有面板容器、评论 item 还没渲染出来，旧实现"只重试
        // 一次、间隔 CLICK_MS(0.8-1.8s)"budget 太紧，三条真机视频（各自 99/多条真实评论）连续
        // 复现 extracted 0 comments。6 × 700ms = 4.2s 额外轮询预算，叠加在 EXTRACTION_TIMEOUT_MS
        // (≈120s) 硬顶内完全负担得起。
        internal const val COMMENT_LIST_POLL_ATTEMPTS = 6
        private const val COMMENT_LIST_POLL_MS = 700L

        /**
         * navigateBackToResults 判据（真机 2026-07-13 19:52 xian-rog，广告 abort 修复后浮现的下一层）：
         * 采完 card#0 点开进全屏视频播放页，旧判据"抖音包内有 1 张卡"太弱——全屏视频那张大卡
         * (1200×2504 clickable)也满足 → 误判"已回搜索结果列表"停止 BACK → 重抓 findVideoCards 只
         * found=1 → card#1+ getOrNull(index)=null → STEP1_no_card → abort，collected 只 1/3。
         * 【搜索结果多卡列表】判据：≥2 张卡（双列）或带搜索 tab 栏（综合/视频）；全屏播放页两者皆不满足。
         */
        internal fun isBackAtResultList(cardCount: Int, hasSearchTabBar: Boolean): Boolean =
            cardCount >= 2 || hasSearchTabBar

        /**
         * 评论列表轮询预算是否已耗尽（0-indexed attempt）。抽成纯函数只是为了把这个
         * 容易写错的边界判断单独钉死——真机复现过"重试预算算错一格，少轮询一次"的坑。
         */
        internal fun isFinalCommentPollAttempt(attempt: Int, maxAttempts: Int): Boolean =
            attempt >= maxAttempts - 1

        /**
         * 评论提取调度闩（真机复现 2026-07-16）：评论面板展开期间会连续打出多条
         * WINDOW_STATE_CHANGED/WINDOW_CONTENT_CHANGED 事件，handleCommentsOpened 和
         * startCommentsTimeout 两条路径都会在看到 state == OPENING_COMMENTS 时各自
         * 调度一次 attemptExtractComments()。只有第一个通过此闸的调用才应该真正调度；
         * 调用方必须在通过闸门后【同步】把 state 转成 EXTRACTING_COMMENTS（不能等
         * delay() 之后才转），否则后续事件在第一次调度真正执行前依然会读到旧状态，
         * 重复调度出多个并发 attemptExtractComments()，互相 recycle 对方的
         * AccessibilityNodeInfo 树（真机 logcat："enriched douyinId 0/1 leads" 3 秒内
         * 重复 15+ 次）。
         */
        internal fun mayScheduleCommentExtraction(state: State): Boolean =
            state == State.OPENING_COMMENTS
        // Bug C 剪贴板取链：单张卡片全程硬超时 + 各阶段等待预算
        // （internal：PER_LEAD_ENRICH_TIMEOUT_MS 的量级守卫要拿它当参照上界）
        internal const val PER_CARD_TIMEOUT_MS = 25_000L
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

        // douyinIds 跟 commentIds/commentTexts 同下标对齐；某条没读到号就是空串""（不是
        // null——List<String> 走这条回调签名图省事，空串当"没有"的哨兵值，调用方 ifEmpty{null}
        // 解回来）。真机复现(2026-07-16)：这个回调签名此前只带 commentIds/commentTexts 两个
        // 平行数组，Seg3 enrichCommentsWithDouyinId() 辛苦点头像读出的真实抖音号，一过这个
        // 回调边界就被丢在原地——AgentService 收到的 CommentEntry 永远 douyinId=null，
        // 不管服务端 /collect/report 收不收这个字段都没用，根本没发出去。
        @Volatile
        var onCollectResult: ((taskId: String, ok: Boolean, commentIds: List<String>, commentTexts: List<String>, douyinIds: List<String>, error: String) -> Unit)? = null

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
        const val EXTRA_RESULT_DOUYIN_IDS = "douyin_ids"
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

        /**
         * 看门狗重入根治(真机复现 2026-07-11 xian-rog 荣耀)：startSearchResultTimeout() 每次
         * 调用都 new 一个协程，旧协程从不 cancel，多个看门狗可并发存活。到期时只有仍是最新
         * generation 的看门狗才有权处理超时判定；被更新一轮 tab 切换重试取代的旧看门狗必须
         * 静默放弃，否则会用创建时刻起算的 10s 预算、读到已被更新的 triedTabSwitch 状态，
         * 在 tab 切换手势还没生效前就误判 SEARCH_TIMEOUT。
         */
        internal fun shouldHonorTimeoutFiring(myGeneration: Int, latestGeneration: Int): Boolean {
            return myGeneration == latestGeneration
        }

        /**
         * Stage1 搜索结果事件到达时该做什么。真机复现(2026-07-11)：搜索结果默认落"综合"tab，
         * 直播/视频/用户混排且直播常排前，旧逻辑只要 findVideoCards 非空就立即采集，从没检查
         * 过是否已切到"视频"tab——在"综合"tab 上一样能凑出卡片（其实混了直播间），点开即进
         * 直播间（无普通视频分享取链路径）→ 全卡 ALL_SHARE_FAILED。
         * 根治：哪怕本次事件已经找到卡片，只要本 task 还没切过一次"视频"tab，也必须先切标签、
         * 忽略这批卡片，等标签切换后的下一个结果事件再采（那时才是"视频"tab 的干净结果）。
         */
        internal fun decideStage1ResultsAction(
            videoCardsFound: Boolean,
            alreadyTriedTabSwitch: Boolean,
        ): ResultsAction {
            if (!videoCardsFound) return ResultsAction.IGNORE
            if (!alreadyTriedTabSwitch) return ResultsAction.WAIT_FOR_TAB_SWITCH
            return ResultsAction.COLLECT
        }

        /**
         * Stage1 单飞闩判据。真机复现(2026-07-11, e8597732 考研 ALL_SHARE_FAILED 0/3)：
         * 单个 task 只派发一次，但 triggerSearch 在 collectVideoCards 已启动后二次触发，把 state
         * 从 COLLECTING_VIDEO_CARDS 重置回 WAITING_SEARCH_RESULTS，第二个 cards=3 搜索结果事件
         * 再次进入 handleSearchResults → 并发启动第二个 collectVideoCards 协程。两个协程同时驱动
         * 抖音 UI，互相 recycle 对方的 AccessibilityNodeInfo 树 → 详情页树塌缩(childCount>0 但
         * getChild 全 null，分享按钮找不到 STEP2)/分享面板抓不到(STEP3)/卡数掉到 1(STEP1) →
         * 全卡片取链失败 ALL_SHARE_FAILED。仅靠 state 守卫不够（state 会被 triggerSearch 重置）；
         * 必须用单调闩：一个 task 只允许启动一次采集 / 一次搜索触发，收到新 task 才在 startCollect 复位。
         *
         * @param collectionAlreadyLaunched 本 task 是否已启动过采集（或已触发过搜索并进入采集）。
         * @return true = 允许启动；false = 已在飞行中，忽略本次重复触发。
         */
        internal fun mayStartStage1Work(collectionAlreadyLaunched: Boolean): Boolean {
            return !collectionAlreadyLaunched
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

        /**
         * Stage1 启动抖音的 Intent flags。
         *
         * 真机复现(2026-07-11)：仅用 getLaunchIntentForPackage 默认叠加的 NEW_TASK 会 resume
         * 到上次采集流程残留的 DetailActivity——采集取分享链会点进视频详情页，任务中途死亡就
         * 把抖音 task 栈留在 detail 页。下一个 Stage1 启动即 resume 到详情页而非首页 feed，
         * openSearchBar 找不到"搜索"入口(searchBtn=false) → 关键词打进详情页聊天框 → 结果页
         * 永不出现 → SEARCH_TIMEOUT（dumpsys 证 topResumedActivity=DetailActivity）。
         *
         * 必须叠加 FLAG_ACTIVITY_CLEAR_TASK 强制清空 task 栈、从 launcher activity 全新启动，
         * 回到干净首页 feed（真机实证 CLEAR_TASK 只清 activity 栈、不动登录态，登录保持）。
         *
         * @param base getLaunchIntentForPackage 返回的 intent 原有 flags。
         * @return 叠加 NEW_TASK|CLEAR_TASK 后的 flags。
         */
        internal fun stage1LaunchFlags(base: Int): Int =
            base or Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK

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
