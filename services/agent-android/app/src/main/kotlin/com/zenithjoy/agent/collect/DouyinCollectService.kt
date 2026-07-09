package com.zenithjoy.agent.collect

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
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

    private var state = State.IDLE
    private var currentKeyword = ""
    private var currentTaskId = ""
    private var searchTriggeredAtMs = 0L
    // A2 重入闸：评论面板每个无障碍事件都会 launch 一个提取协程，state 切走前已排队多个，
    // 导致 reportResult 被调 7~12 次、onResult 重复上报。用一次性闩保证一个任务只上报一次。
    @Volatile private var resultReported = false

    internal enum class State {
        IDLE,
        OPENING_DOUYIN,
        TYPING_KEYWORD,
        SUBMITTING_SEARCH,
        WAITING_SEARCH_RESULTS,
        OPENING_FIRST_VIDEO,
        OPENING_COMMENTS,
        EXTRACTING_COMMENTS,
    }

    private val taskReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            // 诊断守卫：曾经发生过"任务已下发但这里从没打过一行日志"的真机 bug，
            // 无条件在最开头打一行，用来分清"onReceive 完全没被触发"还是
            // "触发了但被某个早退分支吃掉"这两种情况。
            android.util.Log.i(TAG, "onReceive fired: action=${intent?.action}")
            if (intent?.action != ACTION_COLLECT_TASK) return
            val keyword = intent.getStringExtra(EXTRA_KEYWORD) ?: return
            val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""
            if (state != State.IDLE) {
                android.util.Log.w(TAG, "busy — ignoring task $taskId")
                return
            }
            android.util.Log.i(TAG, "task received: keyword=$keyword id=$taskId")
            startCollect(keyword, taskId)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        registerReceiver(taskReceiver, IntentFilter(ACTION_COLLECT_TASK),
            RECEIVER_NOT_EXPORTED)
        android.util.Log.i(TAG, "accessibility service connected")
    }

    override fun onDestroy() {
        scope.cancel()
        unregisterReceiver(taskReceiver)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // 事件分发给当前状态的处理器
        event ?: return
        when (state) {
            State.TYPING_KEYWORD -> handleTypingKeyword(event)
            State.WAITING_SEARCH_RESULTS -> handleSearchResults(event)
            State.OPENING_FIRST_VIDEO -> handleVideoOpened(event)
            State.OPENING_COMMENTS -> handleCommentsOpened(event)
            State.EXTRACTING_COMMENTS -> Unit // 已在 attemptExtractComments 里同步处理
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
        resultReported = false
        state = State.OPENING_DOUYIN
        // 与账号扫描服务共享的全局互斥标记（Sprint 07061301-device-account-scan-wiring）：
        // 采集任务运行期间置 busy=true，扫描服务据此在本轮跳过，避免共用微信/抖音窗口冲突。
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
            val postClickRoot = if (searchBtn != null) {
                searchBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
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
            performGlobalAction(GLOBAL_ACTION_BACK) // dismiss keyboard if shown
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
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
                finishWithError("SEARCH_TIMEOUT")
            }
        }
    }

    // ── 5. 点第一条视频（爆款/参照账号定位入口） ─────────────────────────────

    private fun handleSearchResults(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return
        if (state != State.WAITING_SEARCH_RESULTS) return
        if (isResultEventDebounced(searchTriggeredAtMs, android.os.SystemClock.elapsedRealtime(), RESULTS_SETTLE_MS)) return

        val root = rootInActiveWindow ?: return
        val videoCard = findFirstVideoCard(root) ?: return

        state = State.OPENING_FIRST_VIDEO
        videoCard.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        startVideoOpenTimeout()
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
    }

    private fun startCommentsTimeout() {
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            if (state == State.OPENING_COMMENTS) {
                attemptExtractComments()
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
        val intent = Intent(ACTION_COLLECT_RESULT).apply {
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
        val result = mutableListOf<NodeExtractor.NodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
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

        // 真机 uiautomator dump 验证：搜索结果页的视频卡片根节点是
        // android.view.View（不是 ImageView），resource-id 混淆成短乱码
        // （如 "q7k"），且左右两栏网格布局重复同一个混淆 id——不能硬编码
        // 这类会随构建变化的短乱码，改按"卡片大小的可点击节点"结构匹配：
        // 搜索结果网格卡片宽/高都远大于普通按钮（网格双列，每张卡约占
        // 屏宽一半、屏高四分之一左右），用尺寸阈值排除顶部工具栏的小按钮。
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

    companion object {
        private const val TAG = "DouyinCollectService"
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"
        private const val RESULTS_SETTLE_MS = 400L
        private const val VIDEO_OPEN_TIMEOUT_MS = 15_000L

        const val ACTION_COLLECT_TASK = "com.zenithjoy.agent.COLLECT_TASK"
        const val ACTION_COLLECT_RESULT = "com.zenithjoy.agent.COLLECT_RESULT"
        const val EXTRA_KEYWORD = "keyword"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_RESULT_OK = "ok"
        const val EXTRA_RESULT_COMMENT_IDS = "comment_ids"
        const val EXTRA_RESULT_COMMENT_TEXTS = "comment_texts"
        const val EXTRA_RESULT_ERROR = "error"

        /**
         * 触发搜索后短时间内的结果事件多半是过渡态渲染（联想词/历史列表刷新），
         * 不是真正的搜索结果页，需丢弃防止误点击。
         */
        internal fun isResultEventDebounced(triggeredAtMs: Long, nowMs: Long, settleMs: Long): Boolean {
            return nowMs - triggeredAtMs <= settleMs
        }

        /** 只有从 TYPING_KEYWORD 才允许进入 SUBMITTING_SEARCH，防止重复触发搜索。 */
        internal fun shouldEnterSubmitting(currentState: State): Boolean {
            return currentState == State.TYPING_KEYWORD
        }

        fun dispatchTask(context: Context, keyword: String, taskId: String) {
            val intent = Intent(ACTION_COLLECT_TASK).apply {
                // 显式指定目标包名——隐式应用内广播在部分厂商 ROM 上的分发行为
                // 不完全可靠，显式 setPackage 让系统按包名精确路由，不依赖
                // "同进程/同 UID 就一定能投递"这个假设。
                setPackage(context.packageName)
                putExtra(EXTRA_KEYWORD, keyword)
                putExtra(EXTRA_TASK_ID, taskId)
            }
            context.sendBroadcast(intent)
            android.util.Log.i(TAG, "dispatchTask sendBroadcast called: keyword=$keyword taskId=$taskId")
        }
    }
}
