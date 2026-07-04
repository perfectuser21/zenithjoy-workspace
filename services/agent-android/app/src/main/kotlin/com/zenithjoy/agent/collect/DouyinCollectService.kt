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

/**
 * 抖音无障碍采集服务。
 *
 * 功能：接收 COLLECT_TASK Intent → 驱动状态机完成
 *   关键词搜索 → 点第一条视频 → 进作者主页 → 提取昵称/抖音号/粉丝数/简介 → 回调结果
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
        GOING_TO_PROFILE,
        EXTRACTING_PROFILE,
    }

    private val taskReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
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
            State.GOING_TO_PROFILE -> handleProfileNavigation(event)
            State.EXTRACTING_PROFILE -> handleProfileExtraction(event)
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

    private fun openSearchBar() {
        state = State.TYPING_KEYWORD
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            val root = rootInActiveWindow ?: run {
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

    // ── 5. 点第一条视频 ───────────────────────────────────────────────────────

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

    // ── 6. 进入作者主页 ───────────────────────────────────────────────────────

    private fun handleVideoOpened(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return
        if (state != State.OPENING_FIRST_VIDEO) return
        if (event.packageName != DOUYIN_PKG) return

        val root = rootInActiveWindow ?: return
        val avatar = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/iv_avatar",
            "com.ss.android.ugc.aweme:id/user_avatar",
            "com.ss.android.ugc.aweme:id/author_avatar",
        )
        if (avatar == null) return

        state = State.GOING_TO_PROFILE
        avatar.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        startProfileTimeout()
    }

    private fun startProfileTimeout() {
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            if (state == State.GOING_TO_PROFILE) {
                // 尝试从当前 window 直接提取
                attemptExtract()
            }
        }
    }

    // ── 7. 提取主页字段 ───────────────────────────────────────────────────────

    private fun handleProfileNavigation(event: AccessibilityEvent) {
        if (state != State.GOING_TO_PROFILE) return
        if (event.packageName != DOUYIN_PKG) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) return
        scope.launch {
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            attemptExtract()
        }
    }

    private fun handleProfileExtraction(event: AccessibilityEvent) {
        // 已在 attemptExtract 里同步处理，此处仅兜底
    }

    private fun attemptExtract() {
        state = State.EXTRACTING_PROFILE
        val root = rootInActiveWindow
        if (root == null) {
            finishWithError("NO_PROFILE_WINDOW")
            return
        }

        val nodes = flattenNodes(root)
        val fields = NodeExtractor.extract(nodes)

        if (fields.nickname.isEmpty() && fields.douyinId.isEmpty()) {
            // 还未渲染完，稍候重试一次
            scope.launch {
                delay(RandomDelay.sample(RandomDelay.CLICK_MS))
                val retryRoot = rootInActiveWindow ?: run {
                    finishWithError("RETRY_NO_WINDOW"); return@launch
                }
                val retryFields = NodeExtractor.extract(flattenNodes(retryRoot))
                reportResult(retryFields)
            }
        } else {
            reportResult(fields)
        }
    }

    private fun reportResult(fields: NodeExtractor.ProfileFields) {
        val result = CollectResult(
            ok = fields.nickname.isNotEmpty() || fields.douyinId.isNotEmpty(),
            keyword = currentKeyword,
            nickname = fields.nickname,
            douyinId = fields.douyinId,
            followersCount = fields.followersCount,
            bio = fields.bio,
        )
        android.util.Log.i(TAG, "extracted: nickname=${result.nickname} id=${result.douyinId} fans=${result.followersCount}")
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
            putExtra(EXTRA_RESULT_NICKNAME, result.nickname)
            putExtra(EXTRA_RESULT_DOUYIN_ID, result.douyinId)
            putExtra(EXTRA_RESULT_FOLLOWERS, result.followersCount)
            putExtra(EXTRA_RESULT_BIO, result.bio)
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
        const val EXTRA_RESULT_NICKNAME = "nickname"
        const val EXTRA_RESULT_DOUYIN_ID = "douyin_id"
        const val EXTRA_RESULT_FOLLOWERS = "followers_count"
        const val EXTRA_RESULT_BIO = "bio"
        const val EXTRA_RESULT_ERROR = "error"

        fun dispatchTask(context: Context, keyword: String, taskId: String) {
            val intent = Intent(ACTION_COLLECT_TASK).apply {
                putExtra(EXTRA_KEYWORD, keyword)
                putExtra(EXTRA_TASK_ID, taskId)
            }
            context.sendBroadcast(intent)
        }
    }
}
