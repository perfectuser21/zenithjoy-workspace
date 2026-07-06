package com.zenithjoy.agent.collect

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
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
import com.zenithjoy.agent.account.ScanMutex

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
        SEARCHING,
        WARMING_UP,
        CLICKING_DM_ENTRY,
        TYPING_MESSAGE,
        SENDING,
        AWAITING_RECEIPT,
    }

    /** 本次 lead 处理起始时间（Golden Path Step 2 开始计时，用于 90 秒超时熔断判定）。 */
    private var leadStartedAtMs = 0L

    /** 本机/本号历史关注/点赞动作时间戳（内存态，供每小时频控滑动窗口判定）。 */
    private val followTimestampsMs = mutableListOf<Long>()
    private val likeTimestampsMs = mutableListOf<Long>()

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

    /**
     * 抖音号精确搜索定位主页判定结果。声明在类体（而非 companion object）内，与 [Outcome]
     * 同理，使其可以按 `DouyinDmOutreachService.ProfileMatchResult` 从外部（含单测）直接引用
     * ——嵌套在 companion object 内的类型需要 `Outer.Companion.Type` 才能限定访问，
     * 不满足合同测试文件里 `DouyinDmOutreachService.ProfileMatchResult` 的直接引用写法。
     * 禁止改名为 FOUND/MISS/DUPLICATE 等同义词——PRD 用词是"唯一匹配/零匹配/多匹配"。
     */
    internal enum class ProfileMatchResult {
        UNIQUE,
        NO_MATCH,
        AMBIGUOUS,
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
        // 本 sprint 起该字段承载 lead 的精确抖音号（供 Step 2 搜索定位使用），不再是跳转 URL——
        // dm_assignments 派单 payload 字面定义就是"lead 的抖音号"（见 Golden Path Step 1）。
        val targetDouyinId = profileUrl
        currentProfileUrl = profileUrl
        currentTaskId = taskId
        currentDmAssignmentId = dmAssignmentId
        currentAccountLabel = accountLabel
        leadStartedAtMs = android.os.SystemClock.elapsedRealtime()
        state = State.OPENING_PROFILE
        // 与账号扫描服务共享的全局互斥标记（Sprint 07061301-device-account-scan-wiring）：
        // 触达任务运行期间置 busy=true，扫描服务据此在本轮跳过，避免共用微信/抖音窗口冲突。
        ScanMutex.busy = true

        scope.launch {
            if (!launchDouyinApp()) {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "OPEN_PROFILE_FAILED")
                return@launch
            }
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            if (checkLeadTimeout()) return@launch

            // ── Step 2/3：抖音号精确搜索定位主页 ──────────────────────────────
            state = State.SEARCHING
            if (!locateProfileBySearch(targetDouyinId)) {
                // locateProfileBySearch 内部已在 NO_MATCH/AMBIGUOUS/搜索失败时上报结果，
                // 这里直接结束本次 lead 处理（不重试，转人工核实）。
                return@launch
            }
            if (checkLeadTimeout()) return@launch

            // ── Step 4/5：关注/点赞热身互动（受每小时频控约束） ─────────────────
            state = State.WARMING_UP
            performWarmup()
            if (checkLeadTimeout()) return@launch

            // ── Step 6 起：私信发送（复用既有已验收链路，不改动 classifyOutcome 判定标准）──
            val beforeOpenToken = fetchToken
            val root = awaitRootInActiveWindow() ?: run {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_WINDOW")
                return@launch
            }
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeOpenToken)

            // 真机(39.4.0)主页私信按钮是文本"发私信"(content-desc 未必是"私信")——补按文本查找，
            // 否则点进主页也会误报 NO_DM_ENTRY。
            val dmEntryRaw = findNodeByContentDesc(root, "私信")
                ?: findNodeByText(root, "发私信")
                ?: findNodeByText(root, "私信")
                ?: findNodeByIds(
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

    private fun launchDouyinApp(): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(DOUYIN_PKG) ?: return false
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            applicationContext.startActivity(launchIntent)
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "launchDouyinApp failed: ${e.message}")
            false
        }
    }

    /** 90 秒超时熔断检查：命中即上报 timeout 结果并结束本次 lead 处理。 */
    private fun checkLeadTimeout(): Boolean {
        val elapsedMs = android.os.SystemClock.elapsedRealtime() - leadStartedAtMs
        if (isLeadTimedOut(elapsedMs)) {
            android.util.Log.w(TAG, "dm_outreach lead timed out taskId=$currentTaskId elapsedMs=$elapsedMs")
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "LEAD_TIMEOUT")
            return true
        }
        return false
    }

    /**
     * Golden Path Step 2/3：输入目标抖音号（精确字符串）→ 精确匹配搜索结果 → 点击唯一匹配项。
     * 复用 [DouyinCollectService] 已验证过的搜索框交互模式（content-desc "搜索" 优先，
     * 找不到再退回猜测式 resource-id）。0/多个匹配都不重试，直接上报结果转人工核实。
     * @return true = 已唯一定位到主页（点击后可继续后续流程）；false = 已上报结果，调用方应终止本次 lead。
     */
    private suspend fun locateProfileBySearch(targetDouyinId: String): Boolean {
        val root = awaitRootInActiveWindow() ?: run {
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_WINDOW_BEFORE_SEARCH")
            return false
        }

        val searchBtn = findNodeByContentDesc(root, "搜索") ?: findNodeByIds(
            root,
            "com.ss.android.ugc.aweme:id/search_btn",
            "com.ss.android.ugc.aweme:id/iv_search",
            "com.ss.android.ugc.aweme:id/action_search",
        )
        val searchPageRoot = if (searchBtn != null) {
            searchBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            awaitRootInActiveWindow(attempts = 4) ?: root
        } else {
            root
        }

        val searchInput = findNodeByIds(
            searchPageRoot,
            "com.ss.android.ugc.aweme:id/search_input",
            "com.ss.android.ugc.aweme:id/search_edit_text",
            "com.ss.android.ugc.aweme:id/et_search_kw",
        ) ?: findFirstEditText(searchPageRoot)
        if (searchInput == null) {
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_SEARCH_INPUT")
            return false
        }
        searchInput.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, targetDouyinId)
        }
        searchInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))

        val submitRoot = awaitRootInActiveWindow(attempts = 4) ?: searchPageRoot
        // 真机(39.4.0)实测：IME_ENTER 提交常常不触发搜索(结果页空、连结果 tab 都不出)，必须点
        // 右上角"搜索"按钮才真正执行。而该按钮是 clickable=false 的 TextView(content-desc="搜索")——
        // 无障碍 ACTION_CLICK 对它静默无效，只有坐标点它的 bounds 中心才生效(同抖音大量不可点 TextView)。
        val searchConfirm = findNodeByIds(
            submitRoot,
            "com.ss.android.ugc.aweme:id/search_confirm",
            "com.ss.android.ugc.aweme:id/btn_search",
        ) ?: findNodeByContentDesc(submitRoot, "搜索") ?: findNodeByText(submitRoot, "搜索")
        if (searchConfirm != null) {
            tapNodeCenter(searchConfirm)
        } else {
            findFirstEditText(submitRoot)?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        }
        delay(RandomDelay.sample(RandomDelay.SEARCH_MS))

        val resultsRoot = awaitRootInActiveWindow() ?: run {
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_SEARCH_RESULTS_WINDOW")
            return false
        }
        // 抖音 39.4.0 真机实测：SearchResultActivity 的搜索结果列表【不进无障碍树】(自定义/Lynx
        // 渲染，dump 只见搜索框+tab)，无法按文本定位结果行——老 matchProfileByDouyinId(搜索结果)
        // 恒失败，还会被搜索框回显的裸 id 骗成假 UNIQUE。改为人手操作路径：
        //   ① 切"用户"tab(标签在树里可点) → ② 坐标盲点顶部结果(精确抖音号匹配永远排第一)
        //   → ③ 进主页后页面【进树】，用 verifyProfileMatchesDouyinId 验证点对了人(点错=中止，不误发)。
        // "用户"tab 同样是 clickable=false 的 Button——坐标点它的 bounds 中心才生效。
        findNodeByText(resultsRoot, "用户")?.let { tab ->
            tapNodeCenter(tab)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }
        // 坐标盲点前等结果列表渲染完(用户 tab 结果不在树里，但页面绘制需要时间；点太早会点到空白)。
        awaitRootInActiveWindow(attempts = 6)
        delay(RandomDelay.sample(RandomDelay.SEARCH_MS))
        val beforeProfileToken = fetchToken
        tapTopUserResult()
        delay(RandomDelay.sample(RandomDelay.NAV_MS))
        fetchToken = SnapshotDiscipline.nextFetchToken(beforeProfileToken)
        SnapshotDiscipline.requireFresh(beforeProfileToken, fetchToken)
        val profileRoot = awaitRootInActiveWindow() ?: run {
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_PROFILE_WINDOW")
            return false
        }
        if (!verifyProfileMatchesDouyinId(collectAllNodeTexts(profileRoot), targetDouyinId)) {
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_MATCH")
            return false
        }
        return true
    }

    /**
     * 坐标盲点搜索"用户"tab 下顶部结果行。结果列表不在无障碍树里，只能按屏幕相对位置点击：
     * tab 条下方第一行。真机(1200x2664)实测命中点约 (0.44w, 0.21h)。
     */
    private fun tapTopUserResult() {
        val m = resources.displayMetrics
        tapAtCoordinate(m.widthPixels * 0.44f, m.heightPixels * 0.21f)
    }

    /** 坐标点节点 bounds 中心。用于抖音那些 clickable=false 的 TextView/Button(ACTION_CLICK 无效)。 */
    private fun tapNodeCenter(node: AccessibilityNodeInfo) {
        val r = android.graphics.Rect()
        node.getBoundsInScreen(r)
        tapAtCoordinate(r.exactCenterX(), r.exactCenterY())
    }

    private fun tapAtCoordinate(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 60L))
            .build()
        dispatchGesture(gesture, null, null)
    }

    /**
     * Golden Path Step 4/5：关注/点赞热身互动。按钮态判断（要不要点）与每小时频控（能不能点）
     * 相互独立、都要过才实际点击；找不到按钮/触发频控都尽力而为跳过，不阻塞主流程。
     */
    private suspend fun performWarmup() {
        val root = awaitRootInActiveWindow() ?: return

        val followBtn = findNodeByContentDesc(root, "关注") ?: findNodeByIds(
            root,
            "com.ss.android.ugc.aweme:id/follow_btn",
            "com.ss.android.ugc.aweme:id/tv_follow",
        )
        val followText = followBtn?.text?.toString() ?: followBtn?.contentDescription?.toString()
        val nowForFollow = System.currentTimeMillis()
        if (needsFollowClick(followText) && !isFollowRateLimited(followTimestampsMs, nowForFollow)) {
            followBtn?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            followTimestampsMs.add(nowForFollow)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }

        val postFollowRoot = awaitRootInActiveWindow() ?: root
        val likeBtn = findNodeByContentDesc(postFollowRoot, "点赞") ?: findNodeByIds(
            postFollowRoot,
            "com.ss.android.ugc.aweme:id/like_btn",
            "com.ss.android.ugc.aweme:id/digg_view",
        )
        val likeText = likeBtn?.text?.toString() ?: likeBtn?.contentDescription?.toString()
        val nowForLike = System.currentTimeMillis()
        if (needsLikeClick(likeText) && !isLikeRateLimited(likeTimestampsMs, nowForLike)) {
            likeBtn?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            likeTimestampsMs.add(nowForLike)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }
    }

    private fun collectAllNodeTexts(root: AccessibilityNodeInfo): List<String> {
        val texts = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            node.text?.toString()?.let { if (it.isNotBlank()) texts.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return texts
    }

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
        ScanMutex.busy = false
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

        // ── Sprint 07060927 — 抖音号搜索定位 + 关注点赞热身互动纯函数 ─────────────

        /**
         * 抖音号精确匹配：搜索结果列表里必须与目标抖音号完整字符串相等（禁止用 contains/子串匹配）。
         * 0 个匹配 -> NO_MATCH；恰好 1 个匹配 -> UNIQUE；>=2 个匹配（同名歧义） -> AMBIGUOUS。
         * 两种非 UNIQUE 情况都不重试，交由上层转人工核实（本函数是纯判定，不含重试逻辑）。
         */
        internal fun matchProfileByDouyinId(searchResults: List<String>, targetDouyinId: String): ProfileMatchResult {
            val matchCount = searchResults.count { it == targetDouyinId }
            return when {
                matchCount == 0 -> ProfileMatchResult.NO_MATCH
                matchCount == 1 -> ProfileMatchResult.UNIQUE
                else -> ProfileMatchResult.AMBIGUOUS
            }
        }

        /**
         * 点进主页后验证"确实点对了人"。真机实测(抖音 39.4.0)：搜索结果列表不进无障碍树，
         * 只能坐标盲点顶部结果进主页；主页页面【进树】且含 "抖音号：<id>" 行。本函数在主页
         * 文本里找带"抖音号"前缀、id 精确等于目标的行——命中=点对了人可继续；不命中=点错了
         * (或裸 id 回显)必须中止，绝不误发。前缀是关键判别：搜索框回显是裸 id(无前缀)，
         * 真实主页 id 行永远带"抖音号："前缀，据此天然排除搜索框陷阱。全角/半角冒号都认。
         */
        internal fun verifyProfileMatchesDouyinId(profileTexts: List<String>, targetDouyinId: String): Boolean {
            val regex = Regex("""^抖音号[:：]\s*${Regex.escape(targetDouyinId)}$""")
            return profileTexts.any { regex.matches(it.trim()) }
        }

        /**
         * 关注按钮态判断：文本为"关注"才需要点击；"已关注"/找不到按钮（null，尽力而为跳过，不阻塞）一律不点击。
         */
        internal fun needsFollowClick(buttonText: String?): Boolean = buttonText == "关注"

        /**
         * 点赞按钮态判断：文本为"点赞"才需要点击；"已赞"/找不到按钮（null，无作品/仅关注可见/尽力而为跳过）一律不点击。
         */
        internal fun needsLikeClick(buttonText: String?): Boolean = buttonText == "点赞"

        /**
         * 单个 lead 从 Step 2 起总耗时超过 [limitMs]（默认 90 秒）判定为超时熔断，标记 timeout（区别于 failed）。
         * PRD 用词"超过"= 严格大于，恰好等于阈值的边界值不算超时。
         */
        internal fun isLeadTimedOut(elapsedMs: Long, limitMs: Long = 90_000L): Boolean = elapsedMs > limitMs

        /**
         * 关注每小时频控（PRD NFR：关注 <=10 次/小时，1 小时滑动窗口，独立于既有私信频控）。
         * 统计 (nowMs - windowMs, nowMs] 窗口内历史关注时间戳数量，达到/超过 [limit] 即判定限流
         * （本次动作应跳过，不阻塞、不重试、不排队）；窗口外的历史时间戳不计入。
         */
        internal fun isFollowRateLimited(
            followTimestampsMs: List<Long>,
            nowMs: Long,
            limit: Int = 10,
            windowMs: Long = 3_600_000L,
        ): Boolean {
            val windowStart = nowMs - windowMs
            val countInWindow = followTimestampsMs.count { it > windowStart && it <= nowMs }
            return countInWindow >= limit
        }

        /**
         * 点赞每小时频控（PRD NFR：点赞 <=15 次/小时，1 小时滑动窗口，独立于既有私信频控）。
         * 统计规则同 [isFollowRateLimited]，窗口外历史时间戳不计入。
         */
        internal fun isLikeRateLimited(
            likeTimestampsMs: List<Long>,
            nowMs: Long,
            limit: Int = 15,
            windowMs: Long = 3_600_000L,
        ): Boolean {
            val windowStart = nowMs - windowMs
            val countInWindow = likeTimestampsMs.count { it > windowStart && it <= nowMs }
            return countInWindow >= limit
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
