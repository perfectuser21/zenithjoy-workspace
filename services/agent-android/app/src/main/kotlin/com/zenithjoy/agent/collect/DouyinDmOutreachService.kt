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

/**
 * 抖音私信触达执行服务（Sprint 07052218 followup）。
 *
 * PR #1124 只交付了两个孤立工具类（[DmOutreachRateLimiter] / [SnapshotDiscipline]），
 * 全仓库零调用点——AgentService 完全没有 dm_outreach 任务类型的处理分支，没有任何真实的
 * "打开留言人主页→点私信→输入话术→发送→确认送达"执行流程。本类补齐这条真实执行路径。
 *
 * Golden Path Step 3-6（`sprints/07052218-douyin-dm-outreach-android/contract-draft.md`）：
 *   频控自检 → 打开留言人主页(重抓快照纪律) → 点私信入口(重抓快照) → 输入话术 → 发送
 *   → 读回执(sent/limited/failed) → 广播结果给 AgentService 上报中台。
 *
 * 复用 [DouyinCollectService] 已验证过的真机模式（PR #1119/#1120 教训，同一份纪律不重新发明）：
 *   - 点击后必须重新抓取 root 快照，不能复用点击前的旧引用（用 [SnapshotDiscipline] 判定）
 *   - findNodeByIds / findNodeByContentDesc / findFirstEditText / awaitRootInActiveWindow
 *     同一套无障碍工具函数写法（本类内联一份精简版，避免跨 Service 共享可变状态）
 *   - 频控用 [DmOutreachRateLimiter] 纯函数判定（10 分钟窗口 ≤3 条），由 AgentService 在
 *     dispatchTask 之前先行判定——本类内部只负责"频控已经判过、这次真的要发"之后的执行；
 *     `classifyOutcome` 仍然接收 rateLimited 标记以便结果上报路径统一走同一个判定函数。
 *
 * 判定"何时算真送达"的标准必须与 Windows 路径
 * （`services/agent/src/publishers/douyin-dm-outreach.cjs`）一致：气泡/回执出现才算 sent，
 * 不可点私信按钮/输入框/发送按钮都判 failed，不允许 Android 单独放宽假 sent。
 */
class DouyinDmOutreachService : AccessibilityService() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private var state = State.IDLE
    private var currentTaskId = ""
    private var currentDmAssignmentId = ""
    private var currentAccountLabel = ""
    private var currentProfileUrl = ""
    private var fetchToken = 0

    internal enum class State {
        IDLE,
        OPENING_PROFILE,
        CLICKING_DM_ENTRY,
        TYPING_MESSAGE,
        SENDING,
        AWAITING_RECEIPT,
    }

    /**
     * 三态送达判定结果，字符串取值必须与 Windows 路径
     * （`services/agent/src/publishers/douyin-dm-outreach.cjs`）sent/limited/failed 词汇一致。
     * 声明在类体（而非 companion object）内，使 [classifyOutcome] 的返回类型可以按
     * `DouyinDmOutreachService.Outcome` 从外部（含单测）直接引用。
     */
    internal enum class Outcome {
        SENT,
        LIMITED,
        FAILED,
        ;

        fun toStatusString(): String = when (this) {
            SENT -> "sent"
            LIMITED -> "limited"
            FAILED -> "failed"
        }
    }

    private val taskReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_DM_OUTREACH_TASK) return
            val profileUrl = intent.getStringExtra(EXTRA_PROFILE_URL) ?: return
            val message = intent.getStringExtra(EXTRA_MESSAGE) ?: return
            val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""
            val dmAssignmentId = intent.getStringExtra(EXTRA_DM_ASSIGNMENT_ID) ?: ""
            val accountLabel = intent.getStringExtra(EXTRA_ACCOUNT_LABEL) ?: ""
            if (state != State.IDLE) {
                android.util.Log.w(TAG, "busy — ignoring dm_outreach task $taskId")
                return
            }
            android.util.Log.i(TAG, "dm_outreach task received: taskId=$taskId profileUrl=$profileUrl")
            startOutreach(profileUrl, message, taskId, dmAssignmentId, accountLabel)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        registerReceiver(taskReceiver, IntentFilter(ACTION_DM_OUTREACH_TASK), RECEIVER_NOT_EXPORTED)
        android.util.Log.i(TAG, "dm outreach accessibility service connected")
    }

    override fun onDestroy() {
        scope.cancel()
        unregisterReceiver(taskReceiver)
        super.onDestroy()
    }

    // 全流程用轮询等待窗口就绪（awaitRootInActiveWindow），不依赖事件驱动状态切换，
    // 避免与 DouyinCollectService 共享无障碍事件流时产生状态机交叉污染。
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        android.util.Log.w(TAG, "dm outreach service interrupted")
    }

    // ── 任务入口 ──────────────────────────────────────────────────────────────

    private fun startOutreach(
        profileUrl: String,
        message: String,
        taskId: String,
        dmAssignmentId: String,
        accountLabel: String,
    ) {
        currentProfileUrl = profileUrl
        currentTaskId = taskId
        currentDmAssignmentId = dmAssignmentId
        currentAccountLabel = accountLabel
        state = State.OPENING_PROFILE

        scope.launch {
            if (!openProfile(profileUrl)) {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "OPEN_PROFILE_FAILED")
                return@launch
            }
            delay(RandomDelay.sample(RandomDelay.NAV_MS))

            val beforeOpenToken = fetchToken
            val root = awaitRootInActiveWindow() ?: run {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_WINDOW")
                return@launch
            }
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeOpenToken)

            val dmEntryRaw = findNodeByContentDesc(root, "私信") ?: findNodeByIds(
                root,
                "com.ss.android.ugc.aweme:id/iv_im",
                "com.ss.android.ugc.aweme:id/btn_im",
                "com.ss.android.ugc.aweme:id/tv_send_msg",
            )
            if (dmEntryRaw == null) {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_DM_ENTRY")
                return@launch
            }
            // 真机验证发现：content-desc="私信" 命中的往往是图标叶子节点，isClickable=false，
            // 真正的点击处理挂在它的父容器上——对叶子节点 performAction(ACTION_CLICK) 会静默
            // 无效（页面不跳转），最终在下一步误判成 NO_MESSAGE_INPUT。往上找最近的可点击祖先。
            val dmEntry = findClickableSelfOrAncestor(dmEntryRaw)
            if (dmEntry == null) {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_CLICKABLE_DM_ENTRY")
                return@launch
            }

            state = State.CLICKING_DM_ENTRY
            val beforeClickToken = fetchToken
            dmEntry.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))

            // 点击后必须重新抓取——点击前的 root 快照里没有私信输入页，直接复用会 NO_MESSAGE_INPUT
            // （复用 DouyinCollectService openSearchBar() 同一根因修复模式，PR #1119/#1120 教训）。
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeClickToken)
            SnapshotDiscipline.requireFresh(beforeClickToken, fetchToken)
            val postClickRoot = awaitRootInActiveWindow() ?: run {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_WINDOW_AFTER_DM_CLICK")
                return@launch
            }

            state = State.TYPING_MESSAGE
            val input = findFirstEditText(postClickRoot) ?: run {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_MESSAGE_INPUT")
                return@launch
            }
            input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message)
            }
            input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))

            state = State.SENDING
            val sendRoot = awaitRootInActiveWindow() ?: postClickRoot
            val sendBtn = findNodeByContentDesc(sendRoot, "发送") ?: findNodeByIds(
                sendRoot,
                "com.ss.android.ugc.aweme:id/btn_send",
                "com.ss.android.ugc.aweme:id/send_btn",
            )
            if (sendBtn == null) {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_SEND_BUTTON")
                return@launch
            }
            sendBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)

            state = State.AWAITING_RECEIPT
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            // 读回执：发送成功后输入框会被清空（消息已提交进气泡列表），与 Windows 路径
            // "气泡出现才算 sent"同一标准的 Android 等价信号——避免"点了发送按钮就假 sent"。
            val receiptRoot = awaitRootInActiveWindow()
            val sendConfirmed = receiptRoot != null && isInputCleared(receiptRoot, message)
            finishWithOutcome(dmEntryFound = true, sendConfirmed = sendConfirmed,
                errorCode = if (sendConfirmed) "" else "NO_RECEIPT_CONFIRMED")
        }
    }

    // ── 步骤实现 ──────────────────────────────────────────────────────────────

    private fun openProfile(profileUrl: String): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(DOUYIN_PKG) ?: return false
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            // profile_url 携带具体留言人主页地址；抖音 App 内跳转真机实现依赖 deep-link
            // scheme（本 sprint 先用启动 App 兜底 + 无障碍树内搜索主页元素的方式推进，
            // deep-link 精确跳转留给后续 sprint 按真机验证结果加厚）。
            launchIntent.putExtra(EXTRA_PROFILE_URL, profileUrl)
            applicationContext.startActivity(launchIntent)
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "openProfile failed: ${e.message}")
            false
        }
    }

    /**
     * 真机验证发现：抖音输入框空状态下用 hint 占位符（如"发消息"），部分自定义输入组件会
     * 把 hint 当成 node.getText() 的返回值而不是真正区分 hint/text——用 isNullOrEmpty()
     * 判断"是否已清空"会被非空的 hint 文案误判成"没清空"，导致明明发送成功也报
     * NO_RECEIPT_CONFIRMED。改为直接比对当前文本是否还等于刚发送的消息内容：不等于（无论
     * 是真空还是 hint 占位符）都视为已提交，只有原样残留在输入框里才算没发出去。
     */
    private fun isInputCleared(root: AccessibilityNodeInfo, sentMessage: String): Boolean {
        val input = findFirstEditText(root) ?: return true // 输入框已不在树上，视为已提交
        return input.text?.toString() != sentMessage
    }

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

    private fun findNodeByIds(root: AccessibilityNodeInfo, vararg ids: String): AccessibilityNodeInfo? {
        for (id in ids) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            if (list.isNotEmpty()) return list[0]
        }
        return null
    }

    /**
     * content-desc/resource-id 命中的往往是图标叶子节点（isClickable=false），真正的点击
     * 处理挂在某个祖先容器上。从命中节点起沿 parent 链上溯，返回第一个 isClickable=true 的
     * 节点；命中节点自身可点击则直接返回自身。找不到可点击祖先时返回 null（真机验证发现，
     * 对 clickable=false 的叶子节点 performAction(ACTION_CLICK) 会静默无效，页面不跳转）。
     */
    private fun findClickableSelfOrAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        var depth = 0
        while (current != null && depth < 10) {
            if (current.isClickable) return current
            current = current.parent
            depth++
        }
        return null
    }

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

    // ── 结果上报 ──────────────────────────────────────────────────────────────

    private fun finishWithOutcome(dmEntryFound: Boolean, sendConfirmed: Boolean, errorCode: String) {
        val outcome = classifyOutcome(rateLimited = false, dmEntryFound = dmEntryFound, sendConfirmed = sendConfirmed)
        android.util.Log.i(TAG, "dm_outreach outcome=$outcome taskId=$currentTaskId error=$errorCode")
        state = State.IDLE
        sendResultBroadcast(outcome, errorCode)
    }

    private fun sendResultBroadcast(outcome: Outcome, errorCode: String) {
        val intent = Intent(ACTION_DM_OUTREACH_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_TASK_ID, currentTaskId)
            putExtra(EXTRA_DM_ASSIGNMENT_ID, currentDmAssignmentId)
            putExtra(EXTRA_ACCOUNT_LABEL, currentAccountLabel)
            putExtra(EXTRA_PROFILE_URL, currentProfileUrl)
            putExtra(EXTRA_STATUS, outcome.toStatusString())
            putExtra(EXTRA_ERROR, errorCode)
        }
        sendBroadcast(intent)
    }

    companion object {
        private const val TAG = "DouyinDmOutreachService"
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"

        const val ACTION_DM_OUTREACH_TASK = "com.zenithjoy.agent.DM_OUTREACH_TASK"
        const val ACTION_DM_OUTREACH_RESULT = "com.zenithjoy.agent.DM_OUTREACH_RESULT"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_DM_ASSIGNMENT_ID = "dm_assignment_id"
        const val EXTRA_ACCOUNT_LABEL = "account_label"
        const val EXTRA_PROFILE_URL = "profile_url"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_STATUS = "status"
        const val EXTRA_ERROR = "error"

        /**
         * 判定本次私信触达该记为哪一态。
         * 频控优先级最高（AgentService 派发前已用 [DmOutreachRateLimiter] 判定，rateLimited=true
         * 时不会真正执行任何无障碍操作，直接走这里的 LIMITED 分支）；
         * 其次是"私信入口/发送流程是否真的走通"——找不到入口或送达未被回执确认都判 FAILED，
         * 不允许因为"点了发送按钮"就假 sent（对齐 Windows 路径判定标准）。
         */
        internal fun classifyOutcome(rateLimited: Boolean, dmEntryFound: Boolean, sendConfirmed: Boolean): Outcome {
            return when {
                rateLimited -> Outcome.LIMITED
                !dmEntryFound -> Outcome.FAILED
                !sendConfirmed -> Outcome.FAILED
                else -> Outcome.SENT
            }
        }

        fun dispatchTask(
            context: Context,
            profileUrl: String,
            message: String,
            taskId: String,
            dmAssignmentId: String,
            accountLabel: String,
        ) {
            val intent = Intent(ACTION_DM_OUTREACH_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_PROFILE_URL, profileUrl)
                putExtra(EXTRA_MESSAGE, message)
                putExtra(EXTRA_TASK_ID, taskId)
                putExtra(EXTRA_DM_ASSIGNMENT_ID, dmAssignmentId)
                putExtra(EXTRA_ACCOUNT_LABEL, accountLabel)
            }
            context.sendBroadcast(intent)
            android.util.Log.i(TAG, "dispatchTask sendBroadcast called: taskId=$taskId profileUrl=$profileUrl")
        }

        /**
         * 上层（AgentService）频控判定为拒绝时，直接构造 LIMITED 结果广播，
         * 不启动无障碍执行流程——避免超频还去点击真实 UI。
         */
        fun dispatchRateLimited(
            context: Context,
            taskId: String,
            dmAssignmentId: String,
            accountLabel: String,
            profileUrl: String,
        ) {
            val intent = Intent(ACTION_DM_OUTREACH_RESULT).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_TASK_ID, taskId)
                putExtra(EXTRA_DM_ASSIGNMENT_ID, dmAssignmentId)
                putExtra(EXTRA_ACCOUNT_LABEL, accountLabel)
                putExtra(EXTRA_PROFILE_URL, profileUrl)
                putExtra(EXTRA_STATUS, classifyOutcome(rateLimited = true, dmEntryFound = false, sendConfirmed = false).toStatusString())
                putExtra(EXTRA_ERROR, "RATE_LIMITED")
            }
            context.sendBroadcast(intent)
        }
    }
}
