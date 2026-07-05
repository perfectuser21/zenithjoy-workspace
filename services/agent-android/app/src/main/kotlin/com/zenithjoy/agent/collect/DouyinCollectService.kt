package com.zenithjoy.agent.collect

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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

    private enum class State {
        IDLE,
        OPENING_DOUYIN,
        TYPING_KEYWORD,
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
        state = State.OPENING_DOUYIN

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
            val searchBtn = findNodeByIds(root,
                "com.ss.android.ugc.aweme:id/search_btn",
                "com.ss.android.ugc.aweme:id/iv_search",
                "com.ss.android.ugc.aweme:id/action_search",
            )
            if (searchBtn != null) {
                searchBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            }
            typeKeyword(root)
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
            triggerSearch(rootInActiveWindow ?: return@launch)
        }
    }

    // ── 4. 触发搜索 ───────────────────────────────────────────────────────────

    private fun triggerSearch(root: AccessibilityNodeInfo) {
        val confirmBtn = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/search_confirm",
            "com.ss.android.ugc.aweme:id/btn_search",
        )
        if (confirmBtn != null) {
            confirmBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
            // IME_ACTION_SEARCH
            val input = findFirstEditText(root)
            input?.performAction(AccessibilityNodeInfo.ACTION_NEXT_AT_MOVEMENT_GRANULARITY)
        }
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

        val root = rootInActiveWindow ?: return
        val videoCard = findFirstVideoCard(root) ?: return

        state = State.OPENING_FIRST_VIDEO
        videoCard.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun handleTypingKeyword(event: AccessibilityEvent) {
        // 等待搜索框出现（window change 后再输入）
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.packageName == DOUYIN_PKG
        ) {
            val root = rootInActiveWindow ?: return
            val input = findFirstEditText(root) ?: return
            if (state == State.TYPING_KEYWORD) {
                typeKeyword(root)
                // 只触发一次
                state = State.WAITING_SEARCH_RESULTS
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
        val commentBtn = findNodeByIds(root,
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
        val result = CollectResult(
            ok = comments.isNotEmpty(),
            keyword = currentKeyword,
            comments = comments,
        )
        android.util.Log.i(TAG, "extracted ${comments.size} comments for keyword=$currentKeyword")
        state = State.IDLE
        onResult?.invoke(result)
        sendResultBroadcast(result)
    }

    private fun finishWithError(code: String) {
        android.util.Log.w(TAG, "collect error: $code keyword=$currentKeyword")
        val result = CollectResult(ok = false, keyword = currentKeyword, error = code)
        state = State.IDLE
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

        // fallback：找第一个 clickable 的 ImageView（视频封面）
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isClickable && node.className?.contains("ImageView") == true) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    companion object {
        private const val TAG = "DouyinCollectService"
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"

        const val ACTION_COLLECT_TASK = "com.zenithjoy.agent.COLLECT_TASK"
        const val ACTION_COLLECT_RESULT = "com.zenithjoy.agent.COLLECT_RESULT"
        const val EXTRA_KEYWORD = "keyword"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_RESULT_OK = "ok"
        const val EXTRA_RESULT_COMMENT_IDS = "comment_ids"
        const val EXTRA_RESULT_COMMENT_TEXTS = "comment_texts"
        const val EXTRA_RESULT_ERROR = "error"

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
