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
import com.zenithjoy.agent.account.DouyinLaunchTrampoline
import com.zenithjoy.agent.uia.NodeAwait
import com.zenithjoy.agent.uia.WaitFailure
import com.zenithjoy.agent.uia.awaitNode
import com.zenithjoy.agent.uia.awaitAppForeground
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
 *   - findNodeByIds / findNodeByContentDesc / findFirstEditText / uia.awaitNode（等条件成立）
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

    // 全流程用轮询等待【目标条件成立】（uia.awaitNode），不依赖事件驱动状态切换，
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
            if (!awaitDouyinForeground()) {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "DOUYIN_NOT_FOREGROUND")
                return@launch
            }
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
            // 真机(39.4.0)主页私信按钮是文本"发私信"(content-desc 未必是"私信")——补按文本查找，
            // 否则点进主页也会误报 NO_DM_ENTRY。
            // 2026-08-18：改为等它【真的出现】再判死，而不是「有窗口了」就问一次（主页内容异步加载）。
            val entryOutcome = awaitNode(AWAIT_ENTRY_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDesc(r, "私信")
                    ?: findNodeByText(r, "发私信")
                    ?: findNodeByText(r, "私信")
                    ?: findNodeByIds(
                        r,
                        "com.ss.android.ugc.aweme:id/iv_im",
                        "com.ss.android.ugc.aweme:id/btn_im",
                        "com.ss.android.ugc.aweme:id/tv_send_msg",
                    )
            }
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeOpenToken)
            val dmEntryRaw = entryOutcome.value
            if (dmEntryRaw == null) {
                val failure = NodeAwait.classifyFailure(entryOutcome, DOUYIN_PKG)
                android.util.Log.w(
                    TAG,
                    "dm entry 等待超时 failure=$failure attempts=${entryOutcome.attempts} " +
                        "waitedMs=${entryOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${entryOutcome.lastForegroundPkg}"
                )
                finishWithOutcome(
                    dmEntryFound = false, sendConfirmed = false,
                    errorCode = if (failure == WaitFailure.NO_ROOT) "NO_WINDOW" else "NO_DM_ENTRY",
                )
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
            val inputOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r -> findFirstEditText(r) }

            state = State.TYPING_MESSAGE
            val input = inputOutcome.value ?: run {
                val failure = NodeAwait.classifyFailure(inputOutcome, DOUYIN_PKG)
                android.util.Log.w(
                    TAG,
                    "dm input 等待超时 failure=$failure attempts=${inputOutcome.attempts} " +
                        "waitedMs=${inputOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${inputOutcome.lastForegroundPkg}"
                )
                finishWithOutcome(
                    dmEntryFound = true, sendConfirmed = false,
                    errorCode = if (failure == WaitFailure.NO_ROOT) "NO_WINDOW_AFTER_DM_CLICK" else "NO_MESSAGE_INPUT",
                )
                return@launch
            }
            input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            commitTextRobust(input, message)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))

            state = State.SENDING
            val sendOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDesc(r, "发送") ?: findNodeByIds(
                    r,
                    "com.ss.android.ugc.aweme:id/btn_send",
                    "com.ss.android.ugc.aweme:id/send_btn",
                )
            }
            val sendBtn = sendOutcome.value
            if (sendBtn == null) {
                android.util.Log.w(
                    TAG,
                    "dm send 按钮等待超时 failure=${NodeAwait.classifyFailure(sendOutcome, DOUYIN_PKG)} " +
                        "attempts=${sendOutcome.attempts} waitedMs=${sendOutcome.waitedMs(AWAIT_POLL_MS)}"
                )
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_SEND_BUTTON")
                return@launch
            }
            sendBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)

            state = State.AWAITING_RECEIPT
            delay(RandomDelay.sample(RandomDelay.PROFILE_MS))
            // 读回执：发送成功后输入框会被清空（消息已提交进气泡列表），与 Windows 路径
            // "气泡出现才算 sent"同一标准的 Android 等价信号——避免"点了发送按钮就假 sent"。
            // 2026-08-18：从「等一下看一眼输入框清没清空」改为「等到它真清空为止」。
            // 判定标准本身不变（输入框清空 = 消息已提交进气泡列表 = sent）。
            val receiptOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
                r.takeIf { isInputCleared(it, message) }
            }
            val sendConfirmed = receiptOutcome.hit
            android.util.Log.i(
                TAG,
                "dm receipt: confirmed=$sendConfirmed attempts=${receiptOutcome.attempts} " +
                    "waitedMs=${receiptOutcome.waitedMs(AWAIT_POLL_MS)}"
            )
            finishWithOutcome(dmEntryFound = true, sendConfirmed = sendConfirmed,
                errorCode = if (sendConfirmed) "" else "NO_RECEIPT_CONFIRMED")
        }
    }

    // ── 步骤实现 ──────────────────────────────────────────────────────────────

    // 从后台无障碍服务直接 startActivity 拉抖音被荣耀 iAware 拦截（真机实证，logcat
    // `prevent start activity by iaware`），与 DouyinCollectService/DeviceAccountScanService
    // 同一类问题、同一模式修复：先经透明 trampoline 过一道前台 Activity 再转发，目标 Intent
    // 自带的 dmOutreachLaunchFlags（CLEAR_TASK 语义）原样保留、trampoline 不改写。trampoline
    // 起不来（异常）则回退 launchDouyinDirect() 直启，行为与改动前完全一致。
    private fun launchDouyinApp(): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(DOUYIN_PKG) ?: return false
            // 必须叠加 CLEAR_TASK：仅 NEW_TASK 会 resume 到上一次 dm_outreach 遗留的私信
            // 会话页（真机复现 2026-07-17 xian-rog）——locateProfileBySearch 的通用"搜索"
            // 图标查找在会话页里命中的是会话内搜索而非首页全局搜索，把目标抖音号打进消息
            // 搜索框导致 NO_MATCH。CLEAR_TASK 强制清栈回干净首页（同 DouyinCollectService
            // 的 stage1LaunchFlags 已验证过的同款模式，不动登录态）。
            launchIntent.flags = dmOutreachLaunchFlags(launchIntent.flags)
            applicationContext.startActivity(
                DouyinLaunchTrampoline.buildTrampolineIntentForTarget(applicationContext, launchIntent),
            )
            true
        } catch (e: Exception) {
            android.util.Log.w(TAG, "trampoline launchDouyinApp failed: ${e.message}, 回退直启")
            launchDouyinDirect()
        }
    }

    // 直启回退：trampoline 起不来时的兜底路径，逻辑与改动前的 launchDouyinApp() 完全一致。
    private fun launchDouyinDirect(): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(DOUYIN_PKG) ?: return false
            launchIntent.flags = dmOutreachLaunchFlags(launchIntent.flags)
            applicationContext.startActivity(launchIntent)
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "launchDouyinApp failed: ${e.message}")
            false
        }
    }

    /**
     * 拉起抖音后等它【真正】到前台再继续。荣耀等厂商在 app 启动时注入系统开屏广告
     * (com.hihonor.systemmanager AppSplashAdvertiseActivity)/系统更新/兼容提醒等 interstitial，
     * 盖在抖音上——原来固定 delay 后直接 awaitRootInActiveWindow 抓到的是厂商弹窗而非抖音，
     * 整条 flow 误判 NO_SEARCH_INPUT(上一份 handoff 误当"启动失败"的真凶之一)。改为轮询前台包名
     * ==抖音；期间前台是非抖音弹窗则先点"跳过/关闭/稍后/取消/我知道了"、找不到再按返回键消掉；
     * 超时(尽力而为)返回是否已到抖音前台。只在前台非抖音时按返回，绝不在抖音内部误退。
     */
    private suspend fun awaitDouyinForeground(maxAttempts: Int = 24, delayMs: Long = 500): Boolean =
        // 2026-08-18：改为委托共享前台闸 com.zenithjoy.agent.uia.awaitAppForeground。
        // 行为等价（轮询前台包名 + 消厂商插屏 + 只在前台非目标包时按返回），但消除弹窗
        // 改用「可点击祖先 + performAction(ACTION_CLICK)」而不是坐标手势 tapNodeCenter——
        // 真机实证（荣耀 X30/MagicOS 2026-08-18）：同一台设备上 collect 走共享实现能点掉
        // 荣耀 auto-jump「想要打开抖音」授权框并成功拉起抖音，而本文件原坐标手势版本在
        // 同场景下 trampoline Activity 0.3 秒即被销毁、从未可见，最终 OPEN_PANEL_FAILED。
        awaitAppForeground(DOUYIN_PKG, maxAttempts, delayMs)

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
        // 2026-08-18：等搜索入口【真的出现】，不再「有窗口了」就问一次（与 collect 同源根因）。
        val entryOutcome = awaitNode(AWAIT_ENTRY_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodeByContentDesc(r, "搜索") ?: findNodeByIds(
                r,
                "com.ss.android.ugc.aweme:id/search_btn",
                "com.ss.android.ugc.aweme:id/iv_search",
                "com.ss.android.ugc.aweme:id/action_search",
            )
        }
        val searchBtn = entryOutcome.value
        if (searchBtn == null) {
            val failure = NodeAwait.classifyFailure(entryOutcome, DOUYIN_PKG)
            android.util.Log.w(
                TAG,
                "A3-diag: 搜索入口等待超时 failure=$failure attempts=${entryOutcome.attempts} " +
                    "waitedMs=${entryOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${entryOutcome.lastForegroundPkg}"
            )
            finishWithOutcome(
                dmEntryFound = false, sendConfirmed = false,
                errorCode = if (failure == WaitFailure.NO_ROOT) "NO_WINDOW_BEFORE_SEARCH" else "NO_SEARCH_INPUT",
            )
            return false
        }
        searchBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))

        // 点击后等搜索输入框真出现，而不是拿点击前/半成品快照去找。
        val inputOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodeByIds(
                r,
                "com.ss.android.ugc.aweme:id/search_input",
                "com.ss.android.ugc.aweme:id/search_edit_text",
                "com.ss.android.ugc.aweme:id/et_search_kw",
            ) ?: findFirstEditText(r)
        }
        val searchInput = inputOutcome.value
        if (searchInput == null) {
            android.util.Log.w(
                TAG,
                "A3-diag: NO_SEARCH_INPUT searchBtnFound=true failure=" +
                    "${NodeAwait.classifyFailure(inputOutcome, DOUYIN_PKG)} attempts=${inputOutcome.attempts}"
            )
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_SEARCH_INPUT")
            return false
        }
        searchInput.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, targetDouyinId)
        }
        searchInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))

        // 等右上角「搜索」确认按钮出现（打字后它才渲染）。
        val confirmOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodeByIds(
                r,
                "com.ss.android.ugc.aweme:id/search_confirm",
                "com.ss.android.ugc.aweme:id/btn_search",
            ) ?: findNodeByContentDesc(r, "搜索") ?: findNodeByText(r, "搜索")
        }
        val submitRoot = rootInActiveWindow ?: searchInput
        // 真机(39.4.0)实测：IME_ENTER 提交常常不触发搜索(结果页空、连结果 tab 都不出)，必须点
        // 右上角"搜索"按钮才真正执行。而该按钮是 clickable=false 的 TextView(content-desc="搜索")——
        // 无障碍 ACTION_CLICK 对它静默无效，只有坐标点它的 bounds 中心才生效(同抖音大量不可点 TextView)。
        val searchConfirm = confirmOutcome.value
        if (searchConfirm != null) {
            tapNodeCenter(searchConfirm)
        } else {
            findFirstEditText(submitRoot)?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        }
        delay(RandomDelay.sample(RandomDelay.SEARCH_MS))

        // ⚠️ 结果列表是 Lynx 渲染【不进无障碍树】(见下方注释)，所以这里【不能】等结果行；
        // 但「用户」tab 本身在树里，用它当结果页已渲染的锚点。等不到也不阻断（保持原有容错），
        // 只有连 root 都没有才判 NO_SEARCH_RESULTS_WINDOW。
        // ⚠️ finder 每轮执行，必须廉价：这里用系统索引查询 findAccessibilityNodeInfosByText，
        // 不用手动 BFS——本页正是 Lynx 渲染的巨树，全树遍历（每个 getChild 都是跨进程调用）
        // 单次就要几十秒（2026-08-18 collect 侧同款写法真机实测把协程拖死两分钟）。
        val resultsOutcome = awaitNode(AWAIT_PAGE_ATTEMPTS, AWAIT_POLL_MS) { r ->
            r.findAccessibilityNodeInfosByText("用户")?.firstOrNull()
        }
        val resultsRoot = rootInActiveWindow ?: run {
            android.util.Log.w(
                TAG,
                "结果页无窗口 failure=${NodeAwait.classifyFailure(resultsOutcome, DOUYIN_PKG)} " +
                    "attempts=${resultsOutcome.attempts}"
            )
            finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_SEARCH_RESULTS_WINDOW")
            return false
        }
        android.util.Log.i(TAG, "结果页「用户」tab ready=${resultsOutcome.hit} attempts=${resultsOutcome.attempts}")
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
        // 2026-08-18 修正：原写法是 awaitRootInActiveWindow(attempts = 6)，看着像等 6x500ms=3s，
        // 但那个函数是「delay 500 → root 非 null 就 return」，此刻 root 一直非空 → 实际只等了 500ms。
        // 这里的等待对象根本不在无障碍树里（Lynx 渲染），条件式等待无从谈起，只能诚实地等时间。
        delay(3_000L)
        delay(RandomDelay.sample(RandomDelay.SEARCH_MS))
        val beforeProfileToken = fetchToken
        tapTopUserResult()
        delay(RandomDelay.sample(RandomDelay.NAV_MS))
        fetchToken = SnapshotDiscipline.nextFetchToken(beforeProfileToken)
        SnapshotDiscipline.requireFresh(beforeProfileToken, fetchToken)
        // ⚠️ 只等「主页文本已渲染」，绝不能等「匹配成立」——否则「这个主页确实不是目标人」
        // 会被拖成超时，把 NO_MATCH 这个有意义的判定吃掉（那是不误发私信的最后一道闸）。
        // ⚠️ finder 必须廉价：不用 collectAllNodeTexts 全树收集（每轮遍历整棵主页树太贵）。
        // 主页渲染完成的廉价信号：树里出现「关注」或「粉丝」字样（系统索引查询，模糊匹配）。
        // 拿不到这两个词也不阻断——超时后仍走下面原有的 verifyProfileMatchesDouyinId 判定，
        // NO_MATCH 语义完全不变。
        val profileOutcome = awaitNode(AWAIT_PAGE_ATTEMPTS, AWAIT_POLL_MS) { r ->
            r.findAccessibilityNodeInfosByText("粉丝")?.firstOrNull()
                ?: r.findAccessibilityNodeInfosByText("关注")?.firstOrNull()
        }
        if (!profileOutcome.hit) {
            android.util.Log.w(
                TAG,
                "主页渲染信号未等到 failure=${NodeAwait.classifyFailure(profileOutcome, DOUYIN_PKG)} " +
                    "attempts=${profileOutcome.attempts} waitedMs=${profileOutcome.waitedMs(AWAIT_POLL_MS)}，" +
                    "仍按现有逻辑校验主页身份"
            )
        }
        val profileRoot = rootInActiveWindow ?: run {
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
     *
     * 真机(抖音39.4.0)修正：
     * - 关注按钮文案有"关注"(陌生人)/"回关"(对方已关注你、你未关注她)两态，且可能是
     *   content-desc="回关"的 Button 或 text="回关" content-desc=""的 TextView——content-desc+text
     *   两路都找，命中后点最近可点击祖先(叶子可能 clickable=false)。
     * - 点赞：作品网格页【没有点赞按钮】(只有"点赞数N"展示标签，clickable=false)，红心只在
     *   视频详情页 UltraDetailActivity。故打开第一个作品→在视频页点红心→退回主页(供后续私信步骤)。
     */
    private suspend fun performWarmup() {
        // ── 关注/回关（在主页）─────────────────────────────────────────────
        // 主页关注按钮/作品网格是异步加载的，locateProfileBySearch 落地后可能尚未进无障碍树，
        // 故用 awaitNode 轮询重试等其出现(尽力而为，超时仍找不到就跳过，不阻塞主流程)。
        val followBtn = awaitNode { root ->
            findNodeByContentDesc(root, "关注")
                ?: findNodeByContentDesc(root, "回关")
                ?: findNodeByText(root, "关注")
                ?: findNodeByText(root, "回关")
                // 真机(抖音39.4.0)：真正的关注按钮是 clickable TextView，文案被包成
                // "PLACEHOLDER1<关系词>PLACEHOLDER2"(互相关注/关注/回关)，精确 text 匹配抓不到——
                // 按 clickable 节点 text 含"关注"/"回关"补一路(排除 text 为空的"她关注了你"管理横幅)。
                ?: findClickableNodeByTextContains(root, "关注", "回关")
                ?: findNodeByIds(
                    root,
                    "com.ss.android.ugc.aweme:id/follow_btn",
                    "com.ss.android.ugc.aweme:id/tv_follow",
                )
        }.value
        val followText = followBtn?.text?.toString()?.takeIf { it.isNotBlank() }
            ?: followBtn?.contentDescription?.toString()
        val nowForFollow = System.currentTimeMillis()
        val followRateLimited = isFollowRateLimited(followTimestampsMs, nowForFollow)
        val doFollow = needsFollowClick(followText) && !followRateLimited && followBtn != null
        android.util.Log.i(TAG, "warmup follow: btnText=$followText needsClick=${needsFollowClick(followText)} rateLimited=$followRateLimited -> click=$doFollow")
        if (doFollow) {
            (findClickableSelfOrAncestor(followBtn!!) ?: followBtn).performAction(AccessibilityNodeInfo.ACTION_CLICK)
            followTimestampsMs.add(nowForFollow)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }

        // ── 点赞（进作品视频页点红心，非主页）────────────────────────────────
        performVideoLikeWarmup()
    }

    /**
     * 打开主页第一个/置顶作品进视频详情页点红心，完成后退回主页。全程尽力而为，任一步失败都不阻塞私信主流程。
     */
    private suspend fun performVideoLikeWarmup() {
        // 诊断实证：locateProfile 落地时主页树里只有 header(抖音号/发私信/关注/"作品50"tab)，
        // 作品网格在折叠线以下、未进无障碍树。先向下滚把作品网格滚进视口再找第一个作品(缩略图
        // content-desc 形如"点赞数14"，其可点击祖先=作品cell)；滚动+重试若干次仍找不到才尽力而为跳过。
        // 搜索落地的主页作品网格需数秒才渲染进无障碍树，且过早/过度滚动会滚进虚拟化区域反而丢失。
        // 策略：先在初始位置长等(~10s)；仍无则轻滑一次再等一小会；滚过才需滚回顶部。
        var firstWork = awaitNode(maxAttempts = 14, intervalMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }.value
        var scrolled = false
        if (firstWork == null) {
            swipeContentUp()
            scrolled = true
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            firstWork = awaitNode(maxAttempts = 6, intervalMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }.value
        }
        if (firstWork == null) {
            val diagRoot = rootInActiveWindow
            val texts = diagRoot?.let { collectAllNodeTexts(it).take(40) } ?: emptyList()
            android.util.Log.i(TAG, "warmup like: 未找到作品(点赞数*)，跳过点赞。当前页文本=$texts")
            if (scrolled) restoreProfileTop()
            return
        }
        val workCell = findClickableSelfOrAncestor(firstWork) ?: firstWork
        android.util.Log.i(TAG, "warmup like: 找到作品(scrolled=$scrolled)，打开 desc=${firstWork.contentDescription}")
        tapNodeCenter(workCell)
        delay(RandomDelay.sample(RandomDelay.NAV_MS))

        // 视频页红心 content-desc="未点赞/已点赞，喜欢N，按钮"，含"点赞"即命中(含匹配，非精确等于)；
        // awaitNode 轮询等视频详情页红心渲染出来。
        val likeBtn = awaitNode { root -> findNodeByContentDescContains(root, "点赞") }.value
        val likeDesc = likeBtn?.contentDescription?.toString()
        val nowForLike = System.currentTimeMillis()
        val likeRateLimited = isLikeRateLimited(likeTimestampsMs, nowForLike)
        val doLike = needsVideoLikeClick(likeDesc) && !likeRateLimited && likeBtn != null
        android.util.Log.i(TAG, "warmup like: heartDesc=$likeDesc needsClick=${needsVideoLikeClick(likeDesc)} rateLimited=$likeRateLimited -> click=$doLike")
        if (doLike) {
            (findClickableSelfOrAncestor(likeBtn!!) ?: likeBtn).performAction(AccessibilityNodeInfo.ACTION_CLICK)
            likeTimestampsMs.add(nowForLike)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }
        // 退回主页，供后续私信步骤(在主页 header 找"发私信")。仅当为找网格滚动过才需滚回顶部。
        performGlobalAction(GLOBAL_ACTION_BACK)
        delay(RandomDelay.sample(RandomDelay.NAV_MS))
        if (scrolled) restoreProfileTop()
    }

    /** 屏幕中部由下向上滑：内容上移，露出折叠线以下的作品网格。坐标按屏幕尺寸自适应。 */
    private fun swipeContentUp() {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        swipe(x, dm.heightPixels * 0.72f, x, dm.heightPixels * 0.28f, 300L)
    }

    /** 连续下滑滚回主页顶部(露出 header 的"发私信"，供后续私信步骤)。 */
    private suspend fun restoreProfileTop() {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        repeat(3) {
            swipe(x, dm.heightPixels * 0.28f, x, dm.heightPixels * 0.80f, 250L)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        }
    }

    private fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        dispatchGesture(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0L, durationMs))
                .build(),
            null, null,
        )
    }

    // 2026-08-18 已删除本文件私有的 awaitNode：改用共享的 com.zenithjoy.agent.uia.awaitNode。
    // 原实现每一轮内部还调 awaitRootInActiveWindow()（自带最多 8x500ms），真实上限是
    // maxAttempts x 4s 而非 maxAttempts x delayMs，超时预算不可控；共享版本只有一层轮询，
    // 耗时严格等于 maxAttempts x intervalMs，且返回 PollOutcome 带诊断信息。
    // 注意：Kotlin 里私有成员函数会遮蔽同名扩展函数，所以这里必须删干净，不能只是不用它。


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

    // 2026-08-18 已删除 awaitRootInActiveWindow：语义是「等到屏幕上有任何窗口就返回」，
    // 抖音闪屏页与厂商开屏广告页都满足，被当成「目标页面已就绪」用；超时还 return
    // rootInActiveWindow 兜底过期快照。一律改用 com.zenithjoy.agent.uia.awaitNode。

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

    /** 按 content-desc【包含子串】查找(BFS)。用于视频页红心("未点赞，喜欢N，按钮")和作品缩略图("点赞数N")等整句 content-desc。 */
    private fun findNodeByContentDescContains(root: AccessibilityNodeInfo, substr: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.contentDescription?.toString()?.contains(substr) == true) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /**
     * 找【可点击且 text 含指定子串之一】的节点(BFS)。用于抖音真正的关注按钮——它是 clickable
     * TextView，文案被包成 "PLACEHOLDER1<关系词>PLACEHOLDER2"(互相关注/关注/回关)，精确 text 匹配
     * 抓不到；同名的"她关注了你"是 clickable=false 的横幅标签(不匹配 clickable 条件天然被排除)。
     */
    private fun findClickableNodeByTextContains(root: AccessibilityNodeInfo, vararg substrs: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val t = node.text?.toString()
            if (node.isClickable && t != null && substrs.any { t.contains(it) }) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /**
     * B1 话术截断修复：整条一次性写入输入框。
     * 真机(抖音39.4.0)实测 ACTION_SET_TEXT 对含空格/长中文会截断(只写入空格前几字，
     * 私信历史里"你好，这是"就是截断现场)。改用【剪贴板整条粘贴】——对任意输入法一次性
     * 提交、不截断(等价输入法 commitText)；仅当节点不支持粘贴时回退 SET_TEXT 兜底。
     */
    private fun commitTextRobust(input: AccessibilityNodeInfo, text: CharSequence) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
        val pasteSupported = input.actionList.any { it.id == AccessibilityNodeInfo.ACTION_PASTE }
        if (clipboard != null && pasteSupported) {
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("zj_dm", text))
            input.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            android.util.Log.i(TAG, "commitText via clipboard paste, len=${text.length}")
        } else {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            android.util.Log.i(TAG, "commitText via SET_TEXT fallback (paste unsupported), len=${text.length}")
        }
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
        // 等「目标就绪」的轮询预算（2026-08-18）。各步累计最坏 ≈44s，低于 lead 90s 熔断。
        private const val AWAIT_POLL_MS = 500L
        private const val AWAIT_ENTRY_ATTEMPTS = 24    // 12s：私信/搜索入口，含冷启动与厂商开屏广告余量
        private const val AWAIT_PAGE_ATTEMPTS = 12     // 6s：结果页/主页等页面级跳转
        private const val AWAIT_WIDGET_ATTEMPTS = 8    // 4s：输入框/发送按钮等页内控件

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

        /**
         * dm_outreach 启动抖音的 Intent flags：必须叠加 [Intent.FLAG_ACTIVITY_CLEAR_TASK]，
         * 否则仅 NEW_TASK 会 resume 到上一次任务遗留的私信会话页而非首页（真机复现见
         * [launchDouyinApp] 注释）。与 DouyinCollectService.stage1LaunchFlags 同款模式。
         */
        internal fun dmOutreachLaunchFlags(base: Int): Int =
            base or Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK

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
            // 只认「抖音号：<id>」这一条判据。**绝不加昵称 fallback**。
            //
            // #1308 曾加过一个「targetDouyinId 含非 ASCII 时改比昵称字面相等」的 fallback，
            // 其注释声称由 locateProfileBySearch 的 AMBIGUOUS 分支兜底非唯一结果 ——
            // **该兜底不存在**：产出 AMBIGUOUS 的 matchProfileByDouyinId 生产零调用
            // （只有 :393 注释 + :788 定义，注释原文自称「老 matchProfileByDouyinId」）。
            //
            // 真实流程见 locateProfileBySearch :390-396：搜索结果**不进无障碍树**，只能
            // **坐标盲点顶部结果**，落地后全靠本函数判断点没点对。昵称字面相等在同名同姓时
            // 必然误判 → **私信发给陌生人**（回归测试 `same nickname different person must NOT
            // verify` 钉死此点）。
            //
            // 定位键由 Seg3 方案 B′ 保证是**真实抖音号**（点评论头像进主页读 "抖音号：xxx"），
            // 故本函数无需也不得退让。前缀是排除搜索框裸 id 回显陷阱的唯一手段。
            val idRegex = Regex("""^抖音号[:：]\s*${Regex.escape(targetDouyinId)}$""")
            return profileTexts.any { idRegex.matches(it.trim()) }
        }

        /**
         * [verifyProfileMatchesDouyinId] 的孪生函数：不"验证是不是这个号"，而是"读出这是几号"。
         * Seg3 抓评论点头像进主页后用它把真实抖音号读出来回填 lead（真机 2026-07-15 xian-rog：
         * 主页一次 dump 即含 resource-id=.../5mt、text="抖音号：1689210742"）。
         *
         * 判别与孪生函数【完全一致】，故意共用同一条正则骨架：必须整行匹配 "抖音号：<id>"。
         * 前缀是关键判别——搜索框回显的是裸 id（无前缀），真实主页 id 行永远带前缀，据此天然
         * 排除搜索框陷阱；整行锚定（^...$）额外排除 "他的抖音号：123 是假的" 这类叙述句。
         * 全角/半角冒号都认。读不到返回 null——宁可空，不可猜（PR #1306 教训：猜出来的垃圾
         * 会静默污染 Lead 表，空会硬失败并告警）。
         */
        internal fun extractDouyinId(profileTexts: List<String>): String? {
            val regex = Regex("""^抖音号[:：]\s*(\S+)$""")
            for (t in profileTexts) {
                val m = regex.find(t.trim()) ?: continue
                return m.groupValues[1]
            }
            return null
        }

        /**
         * 关注按钮态判断：文本为"关注"或"回关"才需要点击。
         * - "关注"：陌生人主页，未关注 → 点关注。
         * - "回关"：对方已关注你、你尚未关注对方（真机39.4.0实测按钮文案是"回关"不是"关注"），
         *   仍是"未关注→需关注"的动作态，必须点，否则整类回关场景永远漏点。
         * - "已关注"/"相互关注"（已是关注态）/找不到按钮（null，尽力而为跳过，不阻塞）一律不点击。
         */
        internal fun needsFollowClick(buttonText: String?): Boolean {
            // 真机(抖音39.4.0)：真正的关注按钮文案被包成 "PLACEHOLDER1<关系词>PLACEHOLDER2"
            // (占位符=图标/箭头 span)、末尾可能带 TalkBack 角色后缀 ",按钮"——先去壳再判定。
            val s = (buttonText ?: return false)
                .replace(Regex("PLACEHOLDER\\d*"), "")
                .replace("，按钮", "").replace(",按钮", "").replace("按钮", "").trim()
            if (s.isEmpty()) return false
            // 不是关注按钮/已是关注态 → 不点：
            //  - "(她/他/TA)关注了你" 是状态横幅/管理入口(点它弹 举报/拉黑/取消关注 菜单)，非关注按钮
            //  - 已关注/相互关注/互相关注/已互关/取消关注 = 已经关注了
            if (s.contains("关注了你") || s.contains("已关注") || s.contains("相互关注") ||
                s.contains("互相关注") || s.contains("已互关") || s.contains("取消关注")) return false
            // 需关注态：陌生人"关注"、对方已关注你的回关"回关"
            return s == "关注" || s == "回关"
        }

        /**
         * 视频详情页(UltraDetailActivity)红心点赞态判断。真机(抖音39.4.0)红心 content-desc 是整句：
         * 未赞态="未点赞，喜欢N，按钮"，已赞态="已点赞，喜欢N，按钮"。故【content-desc 含"未点赞"才点】；
         * 含"已点赞"(已赞)/找不到(null，尽力而为跳过)/其它(如作品网格"点赞数N"展示标签)一律不点。
         */
        internal fun needsVideoLikeClick(likeButtonDesc: String?): Boolean =
            likeButtonDesc?.contains("未点赞") == true

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
