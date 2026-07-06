package com.zenithjoy.agent.account

import android.accessibilityservice.AccessibilityService
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
            // 无论成功/失败/超时，都必须确保退出"切换账号"界面，不留半开状态——用超时兜底
            // 强制返回。整段扫描（打开面板→读取→关闭面板）给一个总超时窗口。
            val readOutcome = withTimeoutOrNull(SCAN_TOTAL_TIMEOUT_MS) {
                runScanSequence(requestId, tenantId, thisDeviceId)
            }
            if (readOutcome == null) {
                android.util.Log.w(TAG, "account scan timed out — forcing exit from switch-account panel")
                forceCloseSwitchAccountPanel()
                sendScanResultBroadcast(requestId, ok = false, stale = true, accountIds = DeviceAccountRegistry.snapshot().keys.toList(), errorCode = "SCAN_TIMEOUT")
            }
            state = State.IDLE
            ScanMutex.busy = false
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

    /** 打开抖音"切换账号"界面（进入我-头像-切换账号，真机版式待人工核实，见接缝清单）。 */
    private suspend fun openSwitchAccountPanel(): Boolean {
        val root = awaitRootInActiveWindow() ?: return false
        val switchEntry = findNodeByContentDesc(root, "切换账号") ?: findNodeByIds(
            root,
            "com.ss.android.ugc.aweme:id/switch_account_entry",
            "com.ss.android.ugc.aweme:id/tv_switch_account",
        )
        if (switchEntry == null) {
            android.util.Log.w(TAG, "switch-account entry not found on current screen")
            return false
        }
        switchEntry.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        delay(400L)
        return awaitRootInActiveWindow(attempts = 4) != null
    }

    /** 读取"切换账号"面板里当前登录的抖音号列表；读取异常（无障碍超时/崩溃）返回 null。 */
    private suspend fun readAccountListFromPanel(): List<String>? {
        return try {
            val root = awaitRootInActiveWindow() ?: return null
            val panelNodes = findNodesByIds(
                root,
                "com.ss.android.ugc.aweme:id/account_item",
                "com.ss.android.ugc.aweme:id/tv_douyin_id",
            )
            panelNodes.mapNotNull { it.text?.toString() }.filter { it.isNotBlank() }
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
         * 派发前核对：任务派发即隐含"假设账号在线"（recordedOnline=true）；
         * 若注册表（本机最近一次扫描结果）显示该账号已下线，判定不一致 → 触发重扫+本次任务
         * 按未登录处理转失败。注册表里从未出现过的账号（未扫描到过）默认放行，不阻断合法派发。
         */
        internal fun checkDispatchConsistency(douyinId: String): DeviceAccountModel.DispatchAccountDecision {
            val actualLoggedIn = DeviceAccountRegistry.isRecordedOnline(douyinId)
            return DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = true, actualLoggedInAtDispatch = actualLoggedIn)
        }
    }
}
