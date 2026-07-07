package com.zenithjoy.agent.account

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
 * 安卓设备账号扫描无障碍服务（Sprint 07061301-device-account-scan-wiring）。
 *
 * PR #1131 只交付了 [DeviceAccountModel]（9 个纯判定函数）——全仓库零调用点，没有任何
 * 真实的"打开抖音切换账号界面读取账号列表"的无障碍服务代码，[com.zenithjoy.agent.AgentService]
 * 也没有触发账号扫描的逻辑。本类补齐这条真实执行路径。
 *
 * Golden Path Step 1-8（`sprints/07061204-android-device-account-model/contract-draft.md`）：
 *   互斥锁判定 → 打开切换账号界面 → 读取账号列表(成功/失败) → 去重 → tenant绑定 →
 *   双端冲突覆盖/标失效+告警 / 下线判定 → 广播上报给 AgentService 写回中台 → 派发时重扫触发。
 *
 * 复用 [com.zenithjoy.agent.collect.DouyinDmOutreachService] 已验证过的真机模式：
 *   - State 状态机 + BroadcastReceiver 任务触发
 *   - findNodeByContentDesc/BFS 遍历工具函数（本类内联一份精简版）
 *   - 扫描流程无论成功/失败/超时都必须退出"切换账号"界面，用 [withTimeoutOrNull] 兜底强制返回，
 *     不留半开状态污染后续采集/触达操作
 */
class DeviceAccountScanService : AccessibilityService() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private var state = State.IDLE

    internal enum class State {
        IDLE,
        OPENING_SWITCH_ACCOUNT_PANEL,
        READING_ACCOUNT_LIST,
        CLOSING_SWITCH_ACCOUNT_PANEL,
    }

    private val scanTriggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_ACCOUNT_SCAN_TASK) return
            val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: ""
            val tenantId = intent.getStringExtra(EXTRA_TENANT_ID) ?: ""
            val thisDeviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: ""
            if (state != State.IDLE) {
                android.util.Log.w(TAG, "busy with own scan state — ignoring scan request $requestId")
                return
            }
            // Step 1：全局互斥锁判定——采集/触达任务运行中，本轮扫描直接跳过，等下一个周期。
            if (!shouldRunScan()) {
                android.util.Log.i(TAG, "scan skipped this cycle — collect/outreach mutex is held")
                sendScanResultBroadcast(requestId, ok = false, stale = false, accountIds = emptyList(), errorCode = "MUTEX_BUSY")
                return
            }
            android.util.Log.i(TAG, "account scan task received: requestId=$requestId")
            startScan(requestId, tenantId, thisDeviceId)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        registerReceiver(scanTriggerReceiver, IntentFilter(ACTION_ACCOUNT_SCAN_TASK), RECEIVER_NOT_EXPORTED)
        android.util.Log.i(TAG, "account scan accessibility service connected")
    }

    override fun onDestroy() {
        scope.cancel()
        unregisterReceiver(scanTriggerReceiver)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        android.util.Log.w(TAG, "account scan service interrupted")
    }

    // ── 任务入口 ──────────────────────────────────────────────────────────────

    private fun startScan(requestId: String, tenantId: String, thisDeviceId: String) {
        state = State.OPENING_SWITCH_ACCOUNT_PANEL
        ScanMutex.busy = true

        scope.launch {
            runScanWithCleanup(
                timeoutMs = SCAN_TOTAL_TIMEOUT_MS,
                block = { runScanSequence(requestId, tenantId, thisDeviceId) },
                onAbnormalExit = { errorCode ->
                    forceCloseSwitchAccountPanel()
                    sendScanResultBroadcast(
                        requestId,
                        ok = false,
                        stale = true,
                        accountIds = DeviceAccountRegistry.snapshot().keys.toList(),
                        errorCode = errorCode,
                    )
                },
                setIdle = {
                    state = State.IDLE
                    ScanMutex.busy = false
                },
            )
        }
    }

    private suspend fun runScanSequence(requestId: String, tenantId: String, thisDeviceId: String) {
        val opened = openSwitchAccountPanel()
        if (!opened) {
            // 读取失败：保留旧列表标记 stale，不用空值覆盖（Step 2）。
            val resolution = resolveAccountsToPersist(
                readSucceeded = false,
                previousKnownIds = DeviceAccountRegistry.snapshot().keys.toList(),
                freshlyScannedRawIds = emptyList(),
            )
            sendScanResultBroadcast(requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = "OPEN_PANEL_FAILED")
            return
        }

        state = State.READING_ACCOUNT_LIST
        val rawIds = readAccountListFromPanel()
        val readSucceeded = rawIds != null
        val resolution = resolveAccountsToPersist(
            readSucceeded = readSucceeded,
            previousKnownIds = DeviceAccountRegistry.snapshot().keys.toList(),
            freshlyScannedRawIds = rawIds ?: emptyList(),
        )

        if (readSucceeded) {
            val scanAtMs = System.currentTimeMillis()
            val decisions = buildScanDecisions(
                dedupedIds = resolution.accountIds,
                thisDeviceId = thisDeviceId,
                tenantId = tenantId,
                scanAtMs = scanAtMs,
                knownRecords = DeviceAccountRegistry.snapshot(),
            )
            val offlineStatuses = applyOfflineDetection(
                knownDouyinIds = DeviceAccountRegistry.snapshot().keys.toList(),
                currentlyLoggedInIds = resolution.accountIds,
            )
            decisions.forEach { decision ->
                if (decision.invalidateOld) {
                    android.util.Log.w(TAG, "account ${decision.douyinId} moved device — invalidating old record (conflict=${decision.conflict})")
                }
                if (decision.logAlert) {
                    android.util.Log.w(TAG, "CONFLICT ALERT: account ${decision.douyinId} overwritten by device=$thisDeviceId at scanAtMs=$scanAtMs")
                }
                DeviceAccountRegistry.update(
                    decision.douyinId,
                    DeviceAccountRegistry.Entry(deviceId = thisDeviceId, tenantId = tenantId, scanAtMs = scanAtMs, online = true),
                )
            }
            offlineStatuses.forEach { (douyinId, statusResult) ->
                if (statusResult == DeviceAccountModel.AccountOfflineStatus.WENT_OFFLINE) {
                    DeviceAccountRegistry.get(douyinId)?.let { existing ->
                        DeviceAccountRegistry.update(douyinId, existing.copy(online = false))
                    }
                }
            }
        }

        // Step 8（出口）：结果广播给 AgentService，由它调用中台接口写回 agent_platform_sessions。
        sendScanResultBroadcast(requestId, ok = readSucceeded, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = if (readSucceeded) "" else "READ_FAILED")

        state = State.CLOSING_SWITCH_ACCOUNT_PANEL
        closeSwitchAccountPanel()
    }

    // ── 无障碍界面操作 ────────────────────────────────────────────────────────

    /**
     * 打开抖音"切换账号"面板。真机(抖音39.4.0)实测路径：底部 我 tab → 个人页顶部
     * content-desc="切换账号"(clickable) → 弹出 recycler_view 账号面板。
     * 原实现只在"当前屏"找"切换账号"——若触发时在主页 feed 则永远找不到(OPEN_PANEL_FAILED)，
     * 故先点 我 tab(content-desc"我，按钮")导航到个人页，"切换账号"节点这时才进树。
     */
    private suspend fun openSwitchAccountPanel(): Boolean {
        // 先把抖音拉到已知前台(扫描触发时它可能后台/停在任意子页)。
        launchDouyinApp()
        if (!awaitDouyinForeground()) {
            android.util.Log.w(TAG, "抖音未到前台，OPEN_PANEL_FAILED")
            return false
        }
        // CLEAR_TOP relaunch 后抖音本已前台(awaitDouyinForeground 秒返回)，但"顶掉子页→落主页feed"的
        // 导航还没完成，必须等它沉降再点，否则坐标点打在旧页上(实测 OPEN_PANEL_FAILED 真凶)。
        delay(2200L)
        // 【关键】必须用【物理】分辨率算底部导航坐标：resources.displayMetrics 是 app 可用区(不含
        // 系统导航栏，实测 2543<2664)，*0.975 会落在真"我"tab 上方 ~130px 打到视频点赞区(诊断实证)。
        val (sw, sh) = realScreenSize()
        val meX = sw * 0.90f  // 我 tab 在最右列: 1084/1200≈0.90
        val meY = sh * 0.979f // 最底行: 2610/2664≈0.979
        android.util.Log.i(TAG, "realScreen=${sw}x${sh} 我tap=($meX,$meY)")
        // 真机(抖音39.4.0)实测：主页 feed 底部导航"我"tab 是 Lynx 渲染【不进无障碍树】，只能坐标点。
        repeat(3) { attempt ->
            if (attempt > 0) {
                launchDouyinApp(); awaitDouyinForeground(maxAttempts = 8); delay(2000L)
            }
            tapAtCoordinate(meX, meY) // 我 tab
            delay(1500L)
            val profileRoot = awaitRootInActiveWindow()
            val switchEntry = profileRoot?.let {
                // 真 content-desc 带后缀(如"切换账号，用户名有6条未读消息")且位置随账号态变，必须 contains 匹配。
                findNodeByContentDescContains(it, "切换账号") ?: findNodeByText(it, "切换账号")
            }
            if (switchEntry != null) {
                // "切换账号"是 clickable ImageView，坐标点其中心最稳(ACTION_CLICK 对抖音部分节点无效)。
                tapNodeCenter(switchEntry)
                delay(800L)
                val panel = awaitRootInActiveWindow(attempts = 6)
                if (panel != null && findNodeByIds(panel, "com.ss.android.ugc.aweme:id/recycler_view") != null) {
                    return true
                }
                android.util.Log.w(TAG, "点了切换账号但面板未出现(第${attempt + 1}次)")
            } else {
                android.util.Log.w(TAG, "点我tab后未见切换账号(第${attempt + 1}次)，CLEAR_TOP重试")
            }
        }
        android.util.Log.w(TAG, "switch-account panel 打不开 (OPEN_PANEL_FAILED)")
        return false
    }

    /**
     * 拉起抖音并【顶回主页 feed】。真机实测：抖音常恢复到上次的搜索/视频子页(SearchResultActivity 等)，
     * 那些页没有底部导航 → 坐标点"我"tab 落空。用 NEW_TASK|CLEAR_TOP(=0x14000000) relaunch 启动
     * activity(SplashActivity)，把它之上的子 activity 全 finish 掉，落到主页 feed(实测有效)。
     */
    private fun launchDouyinApp(): Boolean = try {
        val launchIntent = applicationContext.packageManager.getLaunchIntentForPackage(DOUYIN_PKG)
        if (launchIntent == null) false
        else {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            applicationContext.startActivity(launchIntent)
            true
        }
    } catch (e: Exception) {
        android.util.Log.e(TAG, "launchDouyinApp failed: ${e.message}"); false
    }

    /** 拉起抖音后等它真正到前台；期间前台是厂商弹窗(荣耀开屏广告/auto-jump/更新)则消掉。尽力而为。 */
    private suspend fun awaitDouyinForeground(maxAttempts: Int = 24, delayMs: Long = 500L): Boolean {
        repeat(maxAttempts) {
            val root = rootInActiveWindow
            val pkg = root?.packageName?.toString()
            if (pkg == DOUYIN_PKG) return true
            if (root != null && pkg != null) {
                val isAutoJump = collectAllNodeTexts(root).any { it.contains("想要打开") || it.contains("是否允许") }
                val allow = if (isAutoJump) (findNodeByText(root, "允许") ?: findNodeByContentDesc(root, "允许")) else null
                val dismiss = allow ?: findNodeByText(root, "跳过") ?: findNodeByText(root, "关闭")
                    ?: findNodeByText(root, "稍后") ?: findNodeByText(root, "取消") ?: findNodeByText(root, "我知道了")
                    ?: findNodeByContentDesc(root, "跳过") ?: findNodeByContentDesc(root, "关闭")
                if (dismiss != null) {
                    (findClickableSelfOrAncestor(dismiss) ?: dismiss).performAction(AccessibilityNodeInfo.ACTION_CLICK)
                } else {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                }
            }
            delay(delayMs)
        }
        return rootInActiveWindow?.packageName?.toString() == DOUYIN_PKG
    }

    private fun collectAllNodeTexts(root: AccessibilityNodeInfo): List<String> {
        val out = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            node.text?.toString()?.let { if (it.isNotBlank()) out.add(it) }
            node.contentDescription?.toString()?.let { if (it.isNotBlank()) out.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return out
    }

    /** 坐标点节点 bounds 中心（抖音部分 clickable=false/ACTION_CLICK 无效节点用手势点）。 */
    private fun tapNodeCenter(node: AccessibilityNodeInfo) {
        val r = Rect(); node.getBoundsInScreen(r)
        tapAtCoordinate(r.exactCenterX(), r.exactCenterY())
    }

    private fun tapAtCoordinate(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 60L))
            .build()
        dispatchGesture(gesture, null, null)
    }

    /** 物理屏幕尺寸(含系统栏)——底部导航坐标点必须用它，不能用 app 可用区的 displayMetrics。 */
    private fun realScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val dm = android.util.DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
            dm.widthPixels to dm.heightPixels
        }
    }

    /**
     * 读取"切换账号"面板里当前登录的账号列表；读取异常（无障碍超时/崩溃）返回 null。
     * 真机(抖音39.4.0)实测：面板 recycler_view 里每个账号行只有 tv_nickname(昵称)，
     * 【没有】抖音号字段——原实现读 tv_douyin_id/account_item 恒空。故按昵称检测
     * "这台机上登录了哪些号"；末行"添加或注册新账号"无 tv_nickname 天然被排除。
     * 注意：昵称仅代表"在切换列表里"，不等于"真登着"——真活性由逐号点进核实(见 verifyAccountLiveness)判定。
     */
    private suspend fun readAccountListFromPanel(): List<String>? {
        return try {
            val root = awaitRootInActiveWindow() ?: return null
            val nicknames = filterAccountNicknames(
                findNodesByIds(root, "com.ss.android.ugc.aweme:id/tv_nickname").map { it.text?.toString() }
            )
            android.util.Log.i(TAG, "readAccountListFromPanel: 读到 ${nicknames.size} 个账号(昵称)=$nicknames")
            nicknames
        } catch (e: Exception) {
            android.util.Log.e(TAG, "readAccountListFromPanel failed: ${e.message}")
            null
        }
    }

    private fun closeSwitchAccountPanel() {
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    /** 超时兜底：不管当前处于哪个状态，强制退出切换账号界面，不留半开状态。 */
    private fun forceCloseSwitchAccountPanel() {
        try {
            performGlobalAction(GLOBAL_ACTION_BACK)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "forceCloseSwitchAccountPanel failed: ${e.message}")
        }
    }

    private suspend fun awaitRootInActiveWindow(
        attempts: Int = 8,
        intervalMs: Long = 500L,
    ): AccessibilityNodeInfo? {
        repeat(attempts) {
            delay(intervalMs)
            rootInActiveWindow?.let { return it }
        }
        return rootInActiveWindow
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

    private fun findNodeByIds(root: AccessibilityNodeInfo, vararg ids: String): AccessibilityNodeInfo? {
        for (id in ids) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            if (list.isNotEmpty()) return list[0]
        }
        return null
    }

    private fun findNodesByIds(root: AccessibilityNodeInfo, vararg ids: String): List<AccessibilityNodeInfo> {
        val results = mutableListOf<AccessibilityNodeInfo>()
        for (id in ids) {
            results.addAll(root.findAccessibilityNodeInfosByViewId(id))
        }
        return results
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


    /** 节点自身或最近可点祖先（抖音很多可点项 text/desc 挂在不可点子节点上）。 */
    private fun findClickableSelfOrAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var cur: AccessibilityNodeInfo? = node
        var hops = 0
        while (cur != null && hops < 8) {
            if (cur.isClickable) return cur
            cur = cur.parent
            hops++
        }
        return null
    }

    // ── 结果上报 ──────────────────────────────────────────────────────────────

    private fun sendScanResultBroadcast(requestId: String, ok: Boolean, stale: Boolean, accountIds: List<String>, errorCode: String) {
        val intent = Intent(ACTION_ACCOUNT_SCAN_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_RESULT_OK, ok)
            putExtra(EXTRA_RESULT_STALE, stale)
            putExtra(EXTRA_RESULT_ACCOUNT_IDS, accountIds.toTypedArray())
            putExtra(EXTRA_ERROR, errorCode)
        }
        sendBroadcast(intent)
        android.util.Log.i(TAG, "account scan result broadcast: requestId=$requestId ok=$ok stale=$stale accounts=${accountIds.size} error=$errorCode")
    }

    companion object {
        private const val TAG = "DeviceAccountScanSvc"
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"
        private const val SCAN_TOTAL_TIMEOUT_MS = 30_000L

        const val ACTION_ACCOUNT_SCAN_TASK = "com.zenithjoy.agent.ACCOUNT_SCAN_TASK"
        const val ACTION_ACCOUNT_SCAN_RESULT = "com.zenithjoy.agent.ACCOUNT_SCAN_RESULT"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_TENANT_ID = "tenant_id"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_RESULT_OK = "result_ok"
        const val EXTRA_RESULT_STALE = "result_stale"
        const val EXTRA_RESULT_ACCOUNT_IDS = "result_account_ids"
        const val EXTRA_ERROR = "error"

        fun dispatchTask(context: Context, requestId: String, tenantId: String, thisDeviceId: String) {
            val intent = Intent(ACTION_ACCOUNT_SCAN_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_TENANT_ID, tenantId)
                putExtra(EXTRA_DEVICE_ID, thisDeviceId)
            }
            context.sendBroadcast(intent)
        }

        // ── Step 1：全局互斥锁判定 ────────────────────────────────────────────

        /** 采集/触达任务运行中本轮扫描应跳过；空闲时应正常扫描。 */
        internal fun shouldRunScan(): Boolean = !DeviceAccountModel.shouldSkipScanDueToMutex(ScanMutex.busy)

        // ── 面板昵称行过滤（真机读到的原始 tv_nickname 文本 → 干净账号列表）───────
        // 抖音39.4.0"切换账号"面板每行只暴露 tv_nickname（昵称），末行"添加或注册新账号"
        // 是入口不是账号。规则：去空白 → 去空串 → 剔除"添加或注册新账号"入口 → 去重保序。
        internal fun filterAccountNicknames(raw: List<String?>): List<String> =
            raw.asSequence()
                .mapNotNull { it?.trim() }
                .filter { it.isNotEmpty() && it != "添加或注册新账号" }
                .distinct()
                .toList()

        // ── Step 2：扫描数据保鲜（读取失败保留旧列表标记 stale）────────────────

        internal data class ScanReadResolution(val accountIds: List<String>, val stale: Boolean)

        internal fun resolveAccountsToPersist(
            readSucceeded: Boolean,
            previousKnownIds: List<String>,
            freshlyScannedRawIds: List<String>,
        ): ScanReadResolution {
            return when (DeviceAccountModel.resolveScanReadResult(readSucceeded)) {
                DeviceAccountModel.ScanReadOutcome.UPDATE_ACTIVE_LIST ->
                    ScanReadResolution(DeviceAccountModel.dedupeSameDeviceAccounts(freshlyScannedRawIds), stale = false)
                DeviceAccountModel.ScanReadOutcome.KEEP_PREVIOUS_MARK_STALE ->
                    ScanReadResolution(previousKnownIds, stale = true)
            }
        }

        // ── Step 3-5：去重后逐账号跑冲突覆盖判定 + 标失效 + 写告警 ────────────────

        internal data class AccountScanDecision(
            val douyinId: String,
            val conflict: DeviceAccountModel.ConflictResolution,
            val invalidateOld: Boolean,
            val logAlert: Boolean,
        )

        internal fun buildScanDecisions(
            dedupedIds: List<String>,
            thisDeviceId: String,
            tenantId: String,
            scanAtMs: Long,
            knownRecords: Map<String, DeviceAccountRegistry.Entry>,
        ): List<AccountScanDecision> {
            val scanned = dedupedIds.map { DeviceAccountModel.ScannedAccount(it, thisDeviceId, tenantId, scanAtMs) }
            val filtered = DeviceAccountModel.filterAccountsByTenant(scanned, tenantId)
            return filtered.map { account ->
                val known = knownRecords[account.douyinId]
                val resolution = DeviceAccountModel.resolveDeviceConflict(
                    existingDeviceId = known?.deviceId,
                    existingScanAtMs = known?.scanAtMs,
                    newDeviceId = thisDeviceId,
                    newScanAtMs = scanAtMs,
                )
                AccountScanDecision(
                    douyinId = account.douyinId,
                    conflict = resolution,
                    invalidateOld = DeviceAccountModel.shouldInvalidateOldDeviceRecord(resolution),
                    logAlert = DeviceAccountModel.shouldLogConflictAlert(resolution),
                )
            }
        }

        // ── Step 6：下线判定 ─────────────────────────────────────────────────

        internal fun applyOfflineDetection(
            knownDouyinIds: List<String>,
            currentlyLoggedInIds: List<String>,
        ): Map<String, DeviceAccountModel.AccountOfflineStatus> =
            knownDouyinIds.associateWith { DeviceAccountModel.checkAccountOffline(it, currentlyLoggedInIds) }

        // ── Step 7：派发前一致性核对（供 AgentService 在派发采集/触达任务前调用）──

        /**
         * 已知架构空白（2026-07-06 复查结论，见 AgentService.routeDmOutreachTask 调用点注释）：
         * 任务 payload 里的 `account_label` 是用户在中台绑定小号时自己起的任意字符串
         * （apps/api/src/routes/agent-burner.ts `initiate-bind`），跟 `DeviceAccountRegistry`
         * 的 key（扫描面板读到的真实抖音号 douyinId）不是同一套命名空间，且目前绑定链路/
         * `agent_platform_sessions` 表都没有任何字段把两者关联起来——按 account_label 去查
         * registry 永远查不到记录，"按具体账号精确核对"在当前数据基础上做不到诚实实现。
         *
         * 因此本函数做的是降级后的**近似判定**：核对对象从"这一个具体账号"改成"本机
         * （thisDeviceId）本轮扫描是否至少还有一个账号在线"——
         *   - 本机从未扫描到过任何账号（registry 里没有该 deviceId 的记录）→ 默认放行
         *     （不能因为"从没扫描过"就阻断合法派发）。
         *   - 本机扫描到过账号、且至少一个仍标记在线 → 放行（数据滞后也不视为失败性不一致）。
         *   - 本机扫描到过账号、但全部标记下线 → 触发重扫 + 本次任务转失败。
         * 这不能保证"派发用的那一个账号"精确在线，只能保证"这台设备不是已知全灭"。
         * 真正的精确核对需要账号绑定链路补上 douyinId 映射（例如 initiate-bind 时同步真实
         * 登录态 uid，或扫描上报时把 account_label 一起写进 agent_platform_sessions）之后才能升级。
         */
        internal fun checkDispatchConsistency(thisDeviceId: String): DeviceAccountModel.DispatchAccountDecision {
            val knownAccountsOnThisDevice = DeviceAccountRegistry.snapshot().values.filter { it.deviceId == thisDeviceId }
            val actualLoggedIn = knownAccountsOnThisDevice.isEmpty() || knownAccountsOnThisDevice.any { it.online }
            return DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = true, actualLoggedInAtDispatch = actualLoggedIn)
        }

        // ── 扫描协程的超时/异常兜底清理（供 startScan 调用）────────────────────────

        /**
         * 无论 [block]（打开面板→读取→写回注册表→关闭面板整段扫描序列）正常完成、超时、
         * 还是抛出任意非超时异常（真机 UIA 操作常见 IllegalStateException/DeadObjectException
         * 等），[setIdle]（复位 state=IDLE + ScanMutex.busy=false）都必须执行——用 try/finally
         * 兜底，不能只处理 withTimeoutOrNull 返回 null 这一种路径（旧版本的 bug：其他异常会
         * 直接穿透，导致 ScanMutex 永久卡 busy=true、state 永久非 IDLE，切换账号面板可能停留
         * 半开状态）。异常/超时两种异常退出都视为"半开状态"，尝试强制关闭面板 + 广播失败。
         */
        internal suspend fun runScanWithCleanup(
            timeoutMs: Long,
            block: suspend () -> Unit,
            onAbnormalExit: (errorCode: String) -> Unit,
            setIdle: () -> Unit,
            logWarn: (String) -> Unit = { android.util.Log.w(TAG, it) },
            logError: (String) -> Unit = { android.util.Log.e(TAG, it) },
        ) {
            try {
                val outcome = withTimeoutOrNull(timeoutMs) { block() }
                if (outcome == null) {
                    logWarn("account scan timed out — forcing exit from switch-account panel")
                    onAbnormalExit("SCAN_TIMEOUT")
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // 结构化并发的取消信号（例如 onDestroy 里 scope.cancel()）不能当成"扫描失败"吞掉，
                // 必须重新抛出让协程正常完成取消——否则会破坏父协程的取消传播语义。
                throw e
            } catch (e: Exception) {
                logError("account scan failed with unexpected exception — forcing exit from switch-account panel: ${e.message}")
                onAbnormalExit("SCAN_EXCEPTION")
            } finally {
                setIdle()
            }
        }
    }
}
