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
import com.zenithjoy.agent.AgentConfig
import com.zenithjoy.agent.AgentService
import com.zenithjoy.agent.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import com.zenithjoy.agent.uia.FailureClassifier
import com.zenithjoy.agent.uia.LocatorAssistClient
import com.zenithjoy.agent.uia.NodeAwait
import com.zenithjoy.agent.uia.UiTreeSnapshot
import com.zenithjoy.agent.uia.awaitNode
import com.zenithjoy.agent.uia.awaitAppForeground

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
class DeviceAccountScanService : AccessibilityService(), DouyinUiaOps {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private var state = State.IDLE

    // sprint 08031620-android-scan-preconditions：openSwitchAccountPanel() 返回 false 时，
    // 记录具体失败原因(SCREEN_LOCKED/LAUNCH_BLOCKED)供 runScanSequence() 读取上报，不改动
    // DouyinUiaOps 接口既有 Boolean 返回签名（避免波及 DeviceAccountWarmupPass.kt 等其他调用点）。
    private var lastOpenPanelFailureReason: String? = null

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

    private val warmupTriggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_ACCOUNT_WARMUP_TASK) return
            val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: ""
            val thisDeviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: ""
            val operatorNickname = intent.getStringExtra(EXTRA_OPERATOR_NICKNAME) ?: ""
            if (state != State.IDLE) {
                android.util.Log.w(TAG, "busy — ignoring warmup request $requestId")
                return
            }
            // 与扫描/采集/触达共用全局互斥锁：切号有副作用，占用时本轮养号跳过等下个周期。
            if (!shouldRunScan()) {
                android.util.Log.i(TAG, "warmup skipped this cycle — collect/outreach mutex is held")
                sendWarmupResultBroadcast(requestId, thisDeviceId, DeviceAccountModel.aggregateWarmupReport(emptyList()), errorCode = "MUTEX_BUSY")
                return
            }
            android.util.Log.i(TAG, "account warmup task received: requestId=$requestId operator=$operatorNickname")
            startWarmup(requestId, thisDeviceId, operatorNickname)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        registerReceiver(scanTriggerReceiver, IntentFilter(ACTION_ACCOUNT_SCAN_TASK), RECEIVER_NOT_EXPORTED)
        registerReceiver(warmupTriggerReceiver, IntentFilter(ACTION_ACCOUNT_WARMUP_TASK), RECEIVER_NOT_EXPORTED)
        android.util.Log.i(TAG, "account scan accessibility service connected")
    }

    override fun onDestroy() {
        scope.cancel()
        unregisterReceiver(scanTriggerReceiver)
        unregisterReceiver(warmupTriggerReceiver)
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
            val (screenshotB64, treeDump, screenshotFailureReason) = captureFailureDiagnostics()
            val foregroundPackage = rootInActiveWindow?.packageName?.toString()
            val douyinVersionName = captureDouyinVersionName()
            // sprint 08031620：openSwitchAccountPanel() 内部识别出锁屏/后台拦截时会设置
            // lastOpenPanelFailureReason；取不到则回退既有泛化 OPEN_PANEL_FAILED（保持既有语义，
            // 不破坏 DeviceAccountScanServiceBroadcastTest 既有回归断言）。
            when (lastOpenPanelFailureReason) {
                "SCREEN_LOCKED" -> sendScanResultBroadcast(
                    requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds,
                    errorCode = "SCREEN_LOCKED", screenshotB64 = screenshotB64, treeDump = treeDump,
                    versionName = com.zenithjoy.agent.BuildConfig.VERSION_NAME, stage = "SCREEN_LOCKED",
                    foregroundPackage = foregroundPackage,
                    screenshotFailureReason = screenshotFailureReason, douyinVersionName = douyinVersionName,
                )
                "LAUNCH_BLOCKED" -> sendScanResultBroadcast(
                    requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds,
                    errorCode = "LAUNCH_BLOCKED", screenshotB64 = screenshotB64, treeDump = treeDump,
                    versionName = com.zenithjoy.agent.BuildConfig.VERSION_NAME, stage = "LAUNCH_BLOCKED",
                    foregroundPackage = foregroundPackage,
                    screenshotFailureReason = screenshotFailureReason, douyinVersionName = douyinVersionName,
                )
                else -> sendScanResultBroadcast(
                    requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds,
                    errorCode = "OPEN_PANEL_FAILED", screenshotB64 = screenshotB64, treeDump = treeDump,
                    versionName = com.zenithjoy.agent.BuildConfig.VERSION_NAME, stage = "OPEN_PANEL_FAILED",
                    foregroundPackage = foregroundPackage,
                    screenshotFailureReason = screenshotFailureReason, douyinVersionName = douyinVersionName,
                )
            }
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
        val (screenshotB64, treeDump, screenshotFailureReason) =
            if (readSucceeded) Triple(null, null, null) else captureFailureDiagnostics()
        sendScanResultBroadcast(
            requestId, ok = readSucceeded, stale = resolution.stale, accountIds = resolution.accountIds,
            errorCode = if (readSucceeded) "" else "READ_FAILED", screenshotB64 = screenshotB64, treeDump = treeDump,
            screenshotFailureReason = screenshotFailureReason,
            douyinVersionName = if (readSucceeded) null else captureDouyinVersionName(),
        )

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
    override suspend fun openSwitchAccountPanel(): Boolean {
        lastOpenPanelFailureReason = null

        // 锁屏前置检查（sprint 08031620，真机复现 2026-07-31 agent_scan_failures.id da659ea0）：
        // 扫描触发时设备可能处于锁屏，此时任何后续操作都是徒劳。检测当前树是否呈现锁屏特征，
        // 尝试唤醒屏幕后复检；若复检仍是锁屏特征（如密码锁/图案锁等无法程序化解锁的锁屏），
        // 判定不可编程解锁，独立上报 SCREEN_LOCKED，不再混入泛化 OPEN_PANEL_FAILED。
        val preCheckDump = rootInActiveWindow?.let { dumpNodeTreeAsString(it) }
        if (AccountScanFailureClassifier.isLockScreenTreeDump(preCheckDump)) {
            attemptWakeScreen()
            delay(500L)
            val postWakeDump = rootInActiveWindow?.let { dumpNodeTreeAsString(it) }
            if (AccountScanFailureClassifier.isLockScreenTreeDump(postWakeDump)) {
                lastOpenPanelFailureReason = "SCREEN_LOCKED"
                android.util.Log.w(TAG, "设备锁屏且唤醒后仍锁屏，判定不可编程解锁，SCREEN_LOCKED")
                return false
            }
        }

        // 先把抖音拉到已知前台(扫描触发时它可能后台/停在任意子页)。
        launchDouyinApp()
        if (!awaitDouyinForeground()) {
            // 后台启动拦截检测（sprint 08031620，真机复现 2026-07-30 agent_scan_failures.id
            // 236f43b1，realme RMX3478/ColorOS）：startActivity 被系统后台弹窗权限静默拦截，
            // 抖音从未真正进入前台、停留桌面 launcher——与既有 CLEAR_TOP 恢复深层子页是不同
            // 阶段的失败，独立上报 LAUNCH_BLOCKED；无法判定桌面特征时仍走既有 OPEN_PANEL_FAILED。
            val blockedDump = rootInActiveWindow?.let { dumpNodeTreeAsString(it) }
            if (AccountScanFailureClassifier.isHomeLauncherTreeDump(blockedDump)) {
                lastOpenPanelFailureReason = "LAUNCH_BLOCKED"
            }
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
        // 真机复现(2026-07-20，华为AN00机型)：坐标比例(0.90,0.979)是在别的参考机型上量出来的，
        // 在这台设备上点空落在信息流上，OPEN_PANEL_FAILED——但真机诊断树摘要证实"我"tab在这台
        // 设备的无障碍树里其实存在(desc=我，按钮 txt=我)，"Lynx 渲染不进树"这个旧结论不是所有
        // 机型都成立。改为优先查真实节点点它的中心，只有查不到时才退回坐标猜测兜底，不为单一
        // 机型写死坐标。
        repeat(3) { attempt ->
            if (attempt > 0) {
                launchDouyinApp(); awaitDouyinForeground(maxAttempts = 8); delay(2000L)
            }
            // 真机复现(2026-07-29，客户已交付环境MAA-AN00，adb dumpsys实时确认)：CLEAR_TOP
            // relaunch 不总是可靠——有时会恢复到之前停留过的某个深层子页面(比如抖音自己的
            // "个人主页封面预览/更换"页 com.ss.android.ugc.aweme.profile.ui.ProfileCoverPreviewActivity)，
            // 包名依然匹配抖音(awaitDouyinForeground 判定"已到前台"直接放行)，但这类子页面没有
            // 底部导航栏，导致"我"tab查找/坐标兜底全部落空，3次重试全部按同样方式失败(此前误判
            // 为厂商弹窗)。加一层恢复：找不到底部导航栏特征时，多按几次返回键退回主页feed，
            // 而不是冒然对着错误页面点坐标/干等CLEAR_TOP重来(CLEAR_TOP已被证明有时也解决不了)。
            // 用 for+break（不是 repeat{ return@repeat }——那只是 continue，会白跑完剩余轮次）
            // 确保命中主页feed后立即停止，不再多按无意义的返回键。
            for (backAttempt in 0 until 5) {
                val checkRoot = rootInActiveWindow
                val onHomeFeed = checkRoot != null && (
                    findNodeByContentDescContains(checkRoot, "我，按钮") != null ||
                        findNodeByContentDescContains(checkRoot, "首页，按钮") != null
                    )
                if (onHomeFeed) break
                performGlobalAction(GLOBAL_ACTION_BACK)
                delay(600L)
            }
            // findNodeByText(it, "我") 是精确文本匹配，但触发这一步时抖音大概率停在信息流
            // 首页——不受控的 UGC 文案/昵称/评论摘要偶然精确等于"我"的概率不为零。用位置
            // 兜一层：底部导航栏的节点上边界必然落在屏幕最下方，用比例(不是绝对像素)判断，
            // 不为单一机型写死数值。位置不对就当没找到，退回坐标兜底。
            // 2026-08-18：位置校验一并放进 finder —— 等「位置正确的我tab」出现，而不是
            // 「有窗口了」就查一次（底部导航在冷启动/页面切换时并非立刻进无障碍树）。
            val meTabOutcome = awaitNode(AWAIT_TAB_ATTEMPTS, AWAIT_POLL_MS) {
                val candidate = findNodeByContentDescContains(it, "我，按钮") ?: findNodeByText(it, "我")
                candidate?.takeIf { node -> isInBottomNavArea(node, sh) }
            }
            var meTabNode = meTabOutcome.value
            if (meTabNode == null) {
                val failure = NodeAwait.classifyFailure(meTabOutcome, DOUYIN_PKG_FOR_WAIT)
                android.util.Log.w(
                    TAG,
                    "我tab 等待超时 failure=$failure " +
                        "attempts=${meTabOutcome.attempts} waitedMs=${meTabOutcome.waitedMs(AWAIT_POLL_MS)}"
                )
                // AI 保底（铺满第二批）：坐标兜底本来就在，这里加一步先问 AI 指认真实节点，
                // 命中就点节点（比盲坐标准），问不到再退回坐标兜底——不改变最坏情况的行为。
                if (FailureClassifier.shouldAssist(failure)) {
                    meTabNode = tryLocatorAssist("scan_me_tab", "底部导航栏「我」tab（个人主页入口）", "NO_ME_TAB")
                }
            }
            if (meTabNode != null) {
                android.util.Log.i(TAG, "我tab命中无障碍树节点，点节点中心")
                tapNodeCenter(meTabNode)
            } else {
                android.util.Log.i(TAG, "我tab未进无障碍树，降级用坐标兜底")
                tapAtCoordinate(meX, meY) // 我 tab
            }
            // 真机复现(2026-07-28，staging agent_scan_failures，2台设备3次干净复现)：原实现只
            // delay(1500L) 单次检查一次——个人页渲染较慢(CLEAR_TOP冷启动/头像等网络内容加载)时
            // 检查过早，误判"未见切换账号"转CLEAR_TOP重试；每轮重试走同一条固定延迟路径，3次
            // 重试系统性命中同一时序窗口全部失败(失败tree_dump证实"我，按钮"节点其实一直都在，
            // 只是还没等到导航完成)。改为对齐同文件 readMyProfile() 已验证过的轮询等待模式，
            // 最多轮询4次(共≤3200ms)，找到就立即停止，不再死等固定时长。
            var switchEntry: AccessibilityNodeInfo? = null
            for (pollAttempt in 0 until 4) {
                delay(800L)
                val profileRoot = rootInActiveWindow
                switchEntry = profileRoot?.let {
                    // 真 content-desc 带后缀(如"切换账号，用户名有6条未读消息")且位置随账号态变，必须 contains 匹配。
                    findNodeByContentDescContains(it, "切换账号") ?: findNodeByText(it, "切换账号")
                }
                if (switchEntry != null) break
            }
            if (switchEntry != null) {
                // "切换账号"是 clickable ImageView，坐标点其中心最稳(ACTION_CLICK 对抖音部分节点无效)。
                tapNodeCenter(switchEntry)
                // 真机复现(2026-07-29，客户已交付环境MAA-AN00，装含前两次修复的2.1.17真实跑通)：
                // 原实现只 delay(800L) 后调 awaitRootInActiveWindow(attempts=6) 检查一次——但那个
                // 函数语义是"等任意非null根节点出现"就立即返回，不等 recycler_view 这个特定元素
                // 真正渲染完成，面板展开动画/加载较慢时检查过早，误判"面板未出现"。与已验证两次
                // 有效的根因(我tab等待/CLEAR_TOP恢复)完全同源，改为对齐同一轮询模式。
                var panel = awaitSwitchAccountPanel()
                if (panel == null) {
                    // 真机复现(2026-07-29，客户已交付环境MAA-AN00，连续3次100%稳定复现)：点击
                    // "切换账号"有时会误触发相邻的"更换背景"浮层——真机实测证实真正的切换账号
                    // 触发点是账号昵称旁边一个很小的下拉箭头，上方几乎整个大块区域都是"更换
                    // 背景"的点击热区，switchEntry 节点报告的中心坐标稍微偏一点就会落进这个
                    // 热区。检测到这个误触发浮层就先关掉它，再重新点一次switchEntry重试。
                    val overlayRoot = rootInActiveWindow
                    val isBgOverlay = overlayRoot != null &&
                        (findNodeByText(overlayRoot, "更换背景") != null ||
                            findNodeByContentDescContains(overlayRoot, "更换背景") != null)
                    if (isBgOverlay) {
                        val closeBtn = overlayRoot?.let {
                            findNodeByContentDescContains(it, "关闭") ?: findNodeByText(it, "关闭")
                        }
                        if (closeBtn != null) {
                            android.util.Log.w(TAG, "点击切换账号误触发更换背景浮层，关闭后重试")
                            tapNodeCenter(closeBtn)
                            delay(500L)
                            // 真机复现(2026-07-29，客户已交付环境MAA-AN00)：关闭浮层后页面树已经
                            // 刷新，复用关闭浮层【之前】拿到的旧 switchEntry 节点引用点击不生效
                            // (Android AccessibilityNodeInfo 在树刷新后可能失效，静默无效果)——
                            // 必须重新从当前根节点查一次"切换账号"节点再点击，不能用旧引用。
                            val freshRoot = rootInActiveWindow
                            val freshSwitchEntry = freshRoot?.let {
                                findNodeByContentDescContains(it, "切换账号") ?: findNodeByText(it, "切换账号")
                            }
                            if (freshSwitchEntry != null) {
                                tapNodeCenter(freshSwitchEntry)
                                panel = awaitSwitchAccountPanel()
                            }
                        }
                    }
                }
                if (panel != null) {
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

    /** 点击"切换账号"后轮询等待 recycler_view 面板真正渲染出来，最多4次(共≤3200ms)。 */
    // 2026-08-18：改为委托共享原语（行为等价，仍是 4x800ms），顺带从「先睡再看」变成
    // 「先看再睡」——面板已经展开时立即返回，不再白等 800ms。
    private suspend fun awaitSwitchAccountPanel(): AccessibilityNodeInfo? =
        awaitNode(maxAttempts = 4, intervalMs = 800L) { root ->
            root.takeIf { findNodeByIds(it, "com.ss.android.ugc.aweme:id/recycler_view") != null }
        }.value

    /**
     * 拉起抖音并【顶回主页 feed】。真机实测：抖音常恢复到上次的搜索/视频子页(SearchResultActivity 等)，
     * 那些页没有底部导航 → 坐标点"我"tab 落空。用 NEW_TASK|CLEAR_TOP(=0x14000000) relaunch 启动
     * activity(SplashActivity)，把它之上的子 activity 全 finish 掉，落到主页 feed(实测有效)。
     */
    /**
     * 尝试唤醒屏幕（sprint 08031620）：真机复现 07-31 锁屏场景失败瞬间屏幕熄灭/锁定，任何后续
     * startActivity/无障碍操作都是徒劳。用短时 WakeLock 触发点亮，不主动尝试解锁手势——图案锁/
     * 密码锁等安全锁屏无法被无障碍服务程序化解锁，唤醒后复检 tree_dump 仍是锁屏特征即判定
     * SCREEN_LOCKED（尽力而为，不保证覆盖所有厂商锁屏实现，见 sprint-prd.md 假设段）。
     */
    @Suppress("DEPRECATION")
    private fun attemptWakeScreen() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return
            val wakeLock = pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                "$TAG:ScanWakeUp",
            )
            wakeLock.acquire(3000L)
            wakeLock.release()
        } catch (e: Exception) {
            android.util.Log.w(TAG, "attemptWakeScreen failed: ${e.message}")
        }
    }

    /**
     * 拉起抖音（Brain task 29320ff1，decision 61298fc6）：先起自家透明 trampoline 让 App 成为
     * 前台 Activity、由它从前台拉起抖音——荣耀 iAware 等厂商策略拒绝"无前台 Activity 的调用方"
     * 直接 startActivity 第三方 App（真机 0/5 → LAUNCH_BLOCKED），自家 Activity 放行（3/3）。
     * 只有 startActivity 本身**抛异常**时才回退直启；OEM 对 trampoline 的静默拦截不会抛异常，
     * 走不到 catch（结果上等价：能拦自家 Activity 的 OEM 大概率也拦直启，终态仍是
     * LAUNCH_BLOCKED）。返回值 true 只表示"trampoline 已发起"，不代表抖音已拉起——
     * 调用方一律以 awaitDouyinForeground() 为准。
     */
    private fun launchDouyinApp(): Boolean = try {
        applicationContext.startActivity(
            DouyinLaunchTrampoline.buildTrampolineIntent(applicationContext, DOUYIN_PKG),
        )
        true
    } catch (e: Exception) {
        android.util.Log.w(TAG, "trampoline 启动失败(${e.message})，退回直接拉起抖音")
        launchDouyinDirect()
    }

    /** 改动前的直启实现，仅作 trampoline 起不来时的回退。 */
    private fun launchDouyinDirect(): Boolean = try {
        val launchIntent = applicationContext.packageManager.getLaunchIntentForPackage(DOUYIN_PKG)
        if (launchIntent == null) false
        else {
            launchIntent.addFlags(DouyinLaunchTrampoline.TARGET_FLAGS)
            applicationContext.startActivity(launchIntent)
            true
        }
    } catch (e: Exception) {
        android.util.Log.e(TAG, "launchDouyinDirect failed: ${e.message}"); false
    }

    /**
     * 拉起抖音后等它真正到前台；期间前台是厂商弹窗(荣耀开屏广告/auto-jump/更新/壁纸推荐)则消掉。尽力而为。
     * 真机复现(2026-07-29，客户已交付环境ANY-AN00)：消除弹窗原先用 performAction(ACTION_CLICK)，
     * 荣耀壁纸推荐弹窗的"关闭"按钮点了没反应(该 App 生态部分节点 ACTION_CLICK 无效，同 openSwitchAccountPanel()
     * 对"切换账号"节点的既有教训)，弹窗一直卡着直到本函数超时，openSwitchAccountPanel() 在最开头
     * "抖音未到前台"这一步就直接失败——与我tab点击等待逻辑是完全不同的根因。改用 tapNodeCenter 手势点击，
     * 对齐同文件已验证过的可靠模式。
     */
    private suspend fun awaitDouyinForeground(maxAttempts: Int = 24, delayMs: Long = 500L): Boolean =
        // 2026-08-18：改为委托共享前台闸 com.zenithjoy.agent.uia.awaitAppForeground。
        // 行为等价（轮询前台包名 + 消厂商插屏 + 只在前台非目标包时按返回），但消除弹窗
        // 改用「可点击祖先 + performAction(ACTION_CLICK)」而不是坐标手势 tapNodeCenter——
        // 真机实证（荣耀 X30/MagicOS 2026-08-18）：同一台设备上 collect 走共享实现能点掉
        // 荣耀 auto-jump「想要打开抖音」授权框并成功拉起抖音，而本文件原坐标手势版本在
        // 同场景下 trampoline Activity 0.3 秒即被销毁、从未可见，最终 OPEN_PANEL_FAILED。
        awaitAppForeground(DOUYIN_PKG, maxAttempts, delayMs)

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

    /**
     * 粗略判定节点是否落在底部导航栏区域：上边界须在屏幕最下方 15% 内。用比例而非绝对像素，
     * 不为单一机型写死数值。防止"我"这种单字精确文本匹配到信息流里偶然出现的无关 UGC 内容。
     */
    private fun isInBottomNavArea(node: AccessibilityNodeInfo, screenHeight: Int): Boolean {
        val r = Rect(); node.getBoundsInScreen(r)
        return r.top >= screenHeight * 0.85f
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
            // 等至少一个昵称节点真出现（面板是异步填充的，「有窗口」不代表列表已渲染）
            val listOutcome = awaitNode(AWAIT_LIST_ATTEMPTS, AWAIT_POLL_MS) { r ->
                r.takeIf { findNodesByIds(it, "com.ss.android.ugc.aweme:id/tv_nickname").isNotEmpty() }
            }
            val root = listOutcome.value
            if (root == null) {
                val failure = NodeAwait.classifyFailure(listOutcome, DOUYIN_PKG_FOR_WAIT)
                android.util.Log.w(
                    TAG,
                    "账号列表等待超时 failure=$failure attempts=${listOutcome.attempts}"
                )
                // AI 保底（铺满收官）：tv_nickname 这个 id 找不到时，先问 AI 从树里读出全部
                // 账号昵称，读不到/AI不可用再判死。这是唯一一个"读一整份列表"的场景，
                // 单值 locate/extract 协议表达不了，走 extract_list。
                if (FailureClassifier.shouldAssist(failure)) {
                    val assisted = tryExtractAccountListAssist()
                    if (assisted != null) {
                        android.util.Log.i(TAG, "readAccountListFromPanel: AI保底读到 ${assisted.size} 个账号(昵称)=$assisted")
                        return assisted
                    }
                }
                return null
            }
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

    /** extract_list 保底：AI 从当前树里读出全部账号昵称。空列表是合法答案（AI 确认没有），
     *  fail-open：任何失败（网络/未配置/解析失败）返回 null，调用方走原判死路径。 */
    private suspend fun tryExtractAccountListAssist(): List<String>? {
        val tree = runCatching {
            rootInActiveWindow?.let { UiTreeSnapshot.serialize(UiTreeSnapshot.fromAccessibilityNode(it)) }
        }.getOrNull() ?: return null
        val httpBase = AgentConfig(applicationContext).deriveHttpBase()
        if (httpBase.isBlank()) return null
        val douyinVer = runCatching {
            applicationContext.packageManager.getPackageInfo(DOUYIN_PKG_FOR_WAIT, 0).versionName
        }.getOrNull()
        val body = LocatorAssistClient.buildAssistBody(
            step = "scan_account_list",
            targetDesc = "切换账号面板里所有已登录（可切换）账号的昵称",
            uiTree = tree,
            errorCode = "NO_ACCOUNT_LIST",
            deviceModel = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim(),
            osVersion = "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})",
            douyinVersion = douyinVer,
            appVersion = BuildConfig.VERSION_NAME,
            mode = "extract_list",
        )
        val (values, assistId) = withContext(Dispatchers.IO) {
            LocatorAssistClient.requestExtractListBlocking(httpBase, body)
        } ?: return null
        val nicknames = filterAccountNicknames(values)
        // 验证闸：这里没有"点了核实"的后续动作可回执，能验的只有"AI 到底读没读出东西"——
        // 有值就算验证通过，空列表也算(AI 诚实说没有)，真失败已经在上面 requestExtractListBlocking
        // 返回 null 那一步被拦住，走不到这里。
        if (assistId != null) {
            scope.launch(Dispatchers.IO) { LocatorAssistClient.reportVerifiedBlocking(httpBase, assistId, true) }
        }
        return nicknames
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

    // 2026-08-18 已删除 awaitRootInActiveWindow：「等到有任何窗口就返回」不等于「目标已就绪」。
    // 本文件 :360 的注释早就诊断出同一根因（它不等 recycler_view 真渲染完就返回，误判面板未出现），
    // 但当时只在切号面板那一处修了。现统一改用 com.zenithjoy.agent.uia.awaitNode。

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

    /**
     * AI on-call 定位求助（铺满第二批，扫号链）：树→AI 指认候选 node，与
     * [com.zenithjoy.agent.collect.DouyinCollectService]/[com.zenithjoy.agent.collect.DouyinDmOutreachService]
     * 里的同名私有实现同款——三个 Service 各自持一份，未抽共享是延续既有代码结构，不引入新抽象。
     */
    private suspend fun tryLocatorAssist(step: String, targetDesc: String, errorCode: String): AccessibilityNodeInfo? {
        val tree = runCatching {
            rootInActiveWindow?.let { UiTreeSnapshot.serialize(UiTreeSnapshot.fromAccessibilityNode(it)) }
        }.getOrNull() ?: return null
        val httpBase = AgentConfig(applicationContext).deriveHttpBase()
        if (httpBase.isBlank()) return null
        val douyinVer = runCatching {
            applicationContext.packageManager.getPackageInfo(DOUYIN_PKG_FOR_WAIT, 0).versionName
        }.getOrNull()
        val body = LocatorAssistClient.buildAssistBody(
            step = step,
            targetDesc = targetDesc,
            uiTree = tree,
            errorCode = errorCode,
            deviceModel = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim(),
            osVersion = "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})",
            douyinVersion = douyinVer,
            appVersion = BuildConfig.VERSION_NAME,
        )
        val answer = withContext(Dispatchers.IO) {
            LocatorAssistClient.requestAssistBlocking(httpBase, body)
        } ?: return null
        val cand = answer.candidates.firstOrNull()
        android.util.Log.i(TAG, "assist locate step=$step cacheHit=${answer.cacheHit} viewId=${cand?.viewId}")
        val viewId = cand?.viewId
        val aid = answer.assistId
        if (viewId == null) {
            if (aid != null) scope.launch(Dispatchers.IO) { LocatorAssistClient.reportVerifiedBlocking(httpBase, aid, false) }
            return null
        }
        val node = rootInActiveWindow?.let { findNodeByIds(it, viewId) }
        if (aid != null) scope.launch(Dispatchers.IO) { LocatorAssistClient.reportVerifiedBlocking(httpBase, aid, node != null) }
        return node
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

    // ── 养号+验活合一 pass（Sprint 07070917，decision ba59f8b7）──────────────────
    // DeviceAccountWarmupPass 的真机 UIA 实现。复用扫描已验证的 helper（launchDouyinApp/
    // awaitDouyinForeground/realScreenSize/tapAtCoordinate/findNode* 等），新增刷视频/切号/读我页。

    private fun startWarmup(requestId: String, thisDeviceId: String, operatorNickname: String) {
        state = State.OPENING_SWITCH_ACCOUNT_PANEL
        ScanMutex.busy = true
        scope.launch {
            var report = DeviceAccountModel.aggregateWarmupReport(emptyList())
            runScanWithCleanup(
                timeoutMs = WARMUP_TOTAL_TIMEOUT_MS,
                block = {
                    report = DeviceAccountWarmupPass(this@DeviceAccountScanService).run(operatorNickname)
                    sendWarmupResultBroadcast(requestId, thisDeviceId, report, errorCode = "")
                },
                onAbnormalExit = { errorCode ->
                    forceCloseToHome()
                    sendWarmupResultBroadcast(requestId, thisDeviceId, report, errorCode = errorCode)
                },
                setIdle = {
                    state = State.IDLE
                    ScanMutex.busy = false
                },
            )
        }
    }

    override suspend fun launchAndSettle(): Boolean {
        launchDouyinApp()
        val fg = awaitDouyinForeground()
        // CLEAR_TOP relaunch 后"顶回主页 feed"未完成，必须沉降再操作（同扫描 openSwitchAccountPanel 的坑）。
        delay(2200L)
        return fg
    }

    override suspend fun readAccountNicknames(): List<String>? = readAccountListFromPanel()

    /** 从当前态开面板→点该昵称行→回主页 feed。面板行只有 tv_nickname，按昵称精确匹配。 */
    override suspend fun switchToAccountByNickname(nickname: String): Boolean {
        if (!openSwitchAccountPanel()) return false
        // 等这一行真出现，而不是「有窗口了」就断言找不到
        val rowOutcome = awaitNode(AWAIT_LIST_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodesByIds(r, "com.ss.android.ugc.aweme:id/tv_nickname")
                .firstOrNull { it.text?.toString()?.trim() == nickname }
        }
        var row = rowOutcome.value
        if (row == null) {
            val failure = NodeAwait.classifyFailure(rowOutcome, DOUYIN_PKG_FOR_WAIT)
            android.util.Log.w(
                TAG,
                "切换账号面板里找不到昵称=$nickname failure=$failure attempts=${rowOutcome.attempts}"
            )
            // AI 保底（铺满第二批）：切号是账号管理链路的关键动作，选错人风险高，判死前先问一次。
            if (FailureClassifier.shouldAssist(failure)) {
                row = tryLocatorAssist("scan_switch_account_row", "切换账号面板里昵称为「$nickname」的那一行", "NO_ACCOUNT_ROW")
            }
        }
        if (row == null) return false
        val clickable = findClickableSelfOrAncestor(row)
        if (clickable != null) clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK) else tapNodeCenter(row)
        delay(2500L) // 切号后回主页 feed 沉降
        return true
    }

    /** 主页 feed 刷 videoCount 个视频：每个先停留看 3.5s 再上滑（纯浏览，不点赞不关注不评论）。 */
    override suspend fun browseFeed(videoCount: Int) {
        repeat(videoCount) {
            delay(3500L)
            swipeUpFeed()
        }
        delay(1000L)
    }

    /**
     * 切"我"页读 昵称 + 粉丝数。真机(抖音39.4.0)我页混淆 id(thp/5pm)随版本变，粉丝数是
     * 数值+"粉丝"label 分离的两个节点——故靠稳定中文锚点 + 几何定位（见 DeviceAccountModel）：
     * 昵称 = "抖音号：xxx"锚点正上方；粉丝数 = "粉丝"label 正上方数值。
     * 读不到"抖音号"锚点（我页没起来/掉线到登录页）返回 null。
     */
    override suspend fun readMyProfile(): MyProfile? {
        repeat(3) { attempt ->
            if (attempt > 0) {
                // 上一轮没落到我页（切号残留态/停在视频子页/底部导航被全屏视频挡）——CLEAR_TOP 回主页 feed 重来。
                launchDouyinApp()
                awaitDouyinForeground(maxAttempts = 8)
                delay(1800L)
            }
            tapMyTab()
            // 我页 Lynx/原生混排，树构建有延迟且时机波动，多轮等"抖音号"锚点出现再读（真机实测第一个号偶发慢）。
            repeat(4) {
                delay(800L)
                val root = rootInActiveWindow ?: return@repeat
                val nodes = collectTextNodes(root)
                val nickname = DeviceAccountModel.findTextAboveAnchor(nodes, "抖音号")
                if (!nickname.isNullOrEmpty()) {
                    val followerText = DeviceAccountModel.findValueAboveLabel(nodes, "粉丝")
                    android.util.Log.i(TAG, "我页 昵称=$nickname 粉丝=$followerText")
                    return MyProfile(nickname, followerText)
                }
            }
            android.util.Log.w(TAG, "我页读不到抖音号锚点(第${attempt + 1}次)")
        }
        android.util.Log.w(TAG, "我页读不到昵称(无抖音号锚点，重试耗尽)")
        return null
    }

    /** 收集当前树所有非空文本节点的 text + 屏幕 bounds（供几何定位）。 */
    private fun collectTextNodes(root: AccessibilityNodeInfo): List<DeviceAccountModel.TextNode> {
        val out = mutableListOf<DeviceAccountModel.TextNode>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val t = node.text?.toString()?.trim()
            if (!t.isNullOrEmpty()) {
                val r = Rect(); node.getBoundsInScreen(r)
                out.add(DeviceAccountModel.TextNode(t, r.left, r.top, r.right, r.bottom))
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return out
    }

    /** 当前树出现登录/注册页文本 = 掉线铁证之一。 */
    override suspend fun sawLoginPage(): Boolean {
        val root = rootInActiveWindow ?: return false
        return collectAllNodeTexts(root).any {
            it.contains("验证码") || it.contains("手机号登录") || it.contains("注册/登录") || it.contains("新用户注册")
        }
    }

    override suspend fun switchToOperator(nickname: String): Boolean = switchToAccountByNickname(nickname)

    override fun forceCloseToHome() {
        launchDouyinApp()
    }

    /** 主页 feed 上滑到下一个视频。 */
    private fun swipeUpFeed() {
        val (w, h) = realScreenSize()
        val path = Path().apply { moveTo(w / 2f, h * 0.72f); lineTo(w / 2f, h * 0.28f) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 300L))
            .build()
        dispatchGesture(gesture, null, null)
    }

    /** 点底部"我"tab（物理分辨率坐标，同 openSwitchAccountPanel 的几何）。 */
    private fun tapMyTab() {
        val (sw, sh) = realScreenSize()
        tapAtCoordinate(sw * 0.90f, sh * 0.979f)
    }

    private fun sendWarmupResultBroadcast(requestId: String, thisDeviceId: String, report: DeviceAccountModel.WarmupReport, errorCode: String) {
        val arr = org.json.JSONArray()
        report.results.forEach { r ->
            arr.put(
                org.json.JSONObject()
                    .put("nickname", r.nickname)
                    .put("alive", r.alive)
                    .put("followers", r.followers ?: org.json.JSONObject.NULL)
                    .put("reason", r.reason),
            )
        }
        val intent = Intent(ACTION_ACCOUNT_WARMUP_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_DEVICE_ID, thisDeviceId)
            putExtra(EXTRA_WARMUP_TOTAL, report.total)
            putExtra(EXTRA_WARMUP_ALIVE, report.aliveCount)
            putExtra(EXTRA_WARMUP_OFFLINE, report.offlineCount)
            putExtra(EXTRA_WARMUP_RESULTS, arr.toString())
            putExtra(EXTRA_ERROR, errorCode)
        }
        sendBroadcast(intent)
        android.util.Log.i(TAG, "warmup result: req=$requestId total=${report.total} alive=${report.aliveCount} offline=${report.offlineCount} err=$errorCode results=$arr")
    }

    // ── 结果上报 ──────────────────────────────────────────────────────────────

    private fun sendScanResultBroadcast(
        requestId: String, ok: Boolean, stale: Boolean, accountIds: List<String>, errorCode: String,
        screenshotB64: String? = null, treeDump: String? = null,
        versionName: String? = null, stage: String? = null, foregroundPackage: String? = null,
        screenshotFailureReason: String? = null, douyinVersionName: String? = null,
    ) {
        val intent = Intent(ACTION_ACCOUNT_SCAN_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_RESULT_OK, ok)
            putExtra(EXTRA_RESULT_STALE, stale)
            putExtra(EXTRA_RESULT_ACCOUNT_IDS, accountIds.toTypedArray())
            putExtra(EXTRA_ERROR, errorCode)
            if (screenshotB64 != null) putExtra(EXTRA_SCREENSHOT_B64, screenshotB64)
            if (treeDump != null) putExtra(EXTRA_TREE_DUMP, treeDump)
            if (versionName != null) putExtra(EXTRA_VERSION_NAME, versionName)
            if (stage != null) putExtra(EXTRA_STAGE, stage)
            if (foregroundPackage != null) putExtra(EXTRA_FOREGROUND_PACKAGE, foregroundPackage)
            if (screenshotFailureReason != null) putExtra(EXTRA_SCREENSHOT_FAILURE_REASON, screenshotFailureReason)
            if (douyinVersionName != null) putExtra(EXTRA_DOUYIN_VERSION_NAME, douyinVersionName)
        }
        sendBroadcast(intent)
        android.util.Log.i(
            TAG,
            "account scan result broadcast: requestId=$requestId ok=$ok stale=$stale accounts=${accountIds.size} " +
                "error=$errorCode hasScreenshot=${screenshotB64 != null} screenshotFailureReason=$screenshotFailureReason",
        )
    }

    /** 设备上抖音 App 真实版本号（诊断用，代替代码里硬编码假设的"抖音39.4.0"，读取失败返回 null 不阻塞）。 */
    private fun captureDouyinVersionName(): String? = try {
        packageManager.getPackageInfo(DOUYIN_PKG, 0).versionName
    } catch (e: Exception) {
        android.util.Log.w(TAG, "douyin versionName query threw: ${e.message}")
        null
    }

    /**
     * 失败诊断捕获：截图（未授权/失败则 null，不阻塞上报）+ 当前无障碍树摘要 +
     * 截图失败原因分类（本次bug修复：此前三种不同失败原因坍缩成同一个不可区分的 null）。
     * 只在 OPEN_PANEL_FAILED/READ_FAILED 路径调用，成功路径不产生额外开销（sprint 07201209）。
     */
    private fun captureFailureDiagnostics(): Triple<String?, String?, String?> {
        // 复用 AgentService 构造的进程内唯一 ScreenCaptureService（sprint 07201209 review 修复）：
        // 不能在这里自己 new 一个新实例——ScreenCaptureReal 是进程级单例 object，manager 字段
        // 全局唯一，第二个 ScreenCaptureService 会撞上 A14 "同一 MediaProjection 不能二次
        // createVirtualDisplay" 纪律并崩溃，殃及 ContentJudgmentService 的截图能力。
        // AgentService 尚未启动（极端时序）时该引用为 null，captureToBase64() 自然短路为 null，
        // 与既有"截图不可用"的优雅降级行为一致。
        //
        // 本次bug修复（真机复现 08-11 run 31427538362 确诊）：此前这里三种不同的截图失败原因
        // （服务未初始化/捕获返回null/捕获抛异常）被同一个 try/catch 静默坍缩成同一个不可区分
        // 的 null，导致历次 OPEN_PANEL_FAILED 现场都无法判断截图诊断本身为什么瞎。现在用
        // AccountScanFailureClassifier.classifyScreenshotCaptureFailure 显式区分三种原因。
        val service = AgentService.sharedScreenCaptureService
        var threwMessage: String? = null
        val screenshot = try {
            service?.captureToBase64()
        } catch (e: Exception) {
            android.util.Log.w(TAG, "failure screenshot capture threw: ${e.message}")
            threwMessage = e.message ?: e.javaClass.simpleName
            null
        }
        val screenshotFailureReason = AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
            serviceAvailable = service != null,
            threwMessage = threwMessage,
            resultIsNull = screenshot == null,
        )
        val tree = try {
            dumpNodeTreeAsString(rootInActiveWindow)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "failure tree dump threw: ${e.message}")
            null
        }
        return Triple(screenshot, tree, screenshotFailureReason)
    }

    companion object {
        // 等「目标就绪」的轮询预算（2026-08-18，与 collect/dm 同一套设施）
        private const val AWAIT_POLL_MS = 500L
        private const val AWAIT_TAB_ATTEMPTS = 12       // 6s
        private const val AWAIT_LIST_ATTEMPTS = 8       // 4s
        private const val DOUYIN_PKG_FOR_WAIT = "com.ss.android.ugc.aweme"

        private const val TAG = "DeviceAccountScanSvc"
        internal const val DOUYIN_PKG = DouyinLaunchTrampoline.DEFAULT_TARGET_PACKAGE
        // 真机复现(2026-07-29，客户已交付环境MAA-AN00)：PR#1554新增"检测更换背景误触发浮层→
        // 关闭→重新查找→重新点击→再等面板"这一步后，单次attempt最坏情况耗时明显变长(实测单次
        // ~8-13秒)，3次CLEAR_TOP重试原30秒预算不够用，会在还没跑完第3次前就被整体超时打断
        // (真机复现SCAN_TIMEOUT而不是更明确的OPEN_PANEL_FAILED)。调大到45秒留足余量。
        private const val SCAN_TOTAL_TIMEOUT_MS = 45_000L
        // 逐号刷2-3视频(每个~3.5s)+切号，多号累计需更长；3min 兜底。
        private const val WARMUP_TOTAL_TIMEOUT_MS = 180_000L

        const val ACTION_ACCOUNT_SCAN_TASK = "com.zenithjoy.agent.ACCOUNT_SCAN_TASK"
        const val ACTION_ACCOUNT_SCAN_RESULT = "com.zenithjoy.agent.ACCOUNT_SCAN_RESULT"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_TENANT_ID = "tenant_id"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_RESULT_OK = "result_ok"
        const val EXTRA_RESULT_STALE = "result_stale"
        const val EXTRA_RESULT_ACCOUNT_IDS = "result_account_ids"
        const val EXTRA_ERROR = "error"
        const val EXTRA_SCREENSHOT_B64 = "screenshot_b64"
        const val EXTRA_TREE_DUMP = "tree_dump"
        const val EXTRA_VERSION_NAME = "version_name"
        const val EXTRA_STAGE = "stage"
        const val EXTRA_FOREGROUND_PACKAGE = "foreground_package"
        const val EXTRA_SCREENSHOT_FAILURE_REASON = "screenshot_failure_reason"
        const val EXTRA_DOUYIN_VERSION_NAME = "douyin_version_name"
        const val ACTION_ACCOUNT_WARMUP_TASK = "com.zenithjoy.agent.ACCOUNT_WARMUP_TASK"
        const val ACTION_ACCOUNT_WARMUP_RESULT = "com.zenithjoy.agent.ACCOUNT_WARMUP_RESULT"
        const val EXTRA_OPERATOR_NICKNAME = "operator_nickname"
        const val EXTRA_WARMUP_TOTAL = "warmup_total"
        const val EXTRA_WARMUP_ALIVE = "warmup_alive"
        const val EXTRA_WARMUP_OFFLINE = "warmup_offline"
        const val EXTRA_WARMUP_RESULTS = "warmup_results"

        fun dispatchTask(context: Context, requestId: String, tenantId: String, thisDeviceId: String) {
            val intent = Intent(ACTION_ACCOUNT_SCAN_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_TENANT_ID, tenantId)
                putExtra(EXTRA_DEVICE_ID, thisDeviceId)
            }
            context.sendBroadcast(intent)
        }

        fun dispatchWarmupTask(context: Context, requestId: String, thisDeviceId: String, operatorNickname: String) {
            val intent = Intent(ACTION_ACCOUNT_WARMUP_TASK).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_DEVICE_ID, thisDeviceId)
                putExtra(EXTRA_OPERATOR_NICKNAME, operatorNickname)
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

/**
 * 无障碍树摘要 dump 的纯逻辑核心，对泛型 T 操作，不碰 Android SDK——JVM 单测环境
 * 无 Mockito/Robolectric，用这个把可测的核心逻辑和真实 AccessibilityNodeInfo 遍历分离
 * （sprint 07201209，账号扫描失败诊断，同 ScreenCaptureService 的注入 lambda 写法）。
 *
 * 顶层函数（非类成员/非 companion 成员）：需要在同包内不加限定符直接调用
 * （见 [DeviceAccountScanServiceTreeDumpTest]），companion object 成员在 Kotlin 里
 * 仍需 `DeviceAccountScanService.xxx` 限定调用，不满足这个要求。
 */
fun <T> dumpNodesGeneric(
    root: T?,
    limit: Int,
    getClassName: (T) -> String,
    getText: (T) -> String?,
    getContentDesc: (T) -> String?,
    getClickable: (T) -> Boolean,
    getBoundsWH: (T) -> Pair<Int, Int>,
    getChildCount: (T) -> Int,
    getChild: (T, Int) -> T?,
): String {
    if (root == null) return "DUMP root=null"
    val sb = StringBuilder()
    val queue = ArrayDeque<T>()
    queue.add(root)
    var n = 0
    while (queue.isNotEmpty() && n < limit) {
        val node = queue.removeFirst()
        val (w, h) = getBoundsWH(node)
        val desc = getContentDesc(node)?.take(40)
        val txt = getText(node)?.take(40)
        val clickable = getClickable(node)
        if (!desc.isNullOrBlank() || !txt.isNullOrBlank() || clickable) {
            sb.appendLine("#$n cls=${getClassName(node)} click=$clickable b=${w}x${h} desc=$desc txt=$txt")
            n++
        }
        for (i in 0 until getChildCount(node)) getChild(node, i)?.let { queue.add(it) }
    }
    sb.appendLine("end printed=$n")
    return sb.toString()
}

/** 真实 AccessibilityNodeInfo 适配层，调用上面的纯逻辑核心。供 Task 2 在失败路径调用。 */
fun dumpNodeTreeAsString(root: AccessibilityNodeInfo?, limit: Int = 80): String = dumpNodesGeneric(
    root = root,
    limit = limit,
    getClassName = { it.className?.toString() ?: "" },
    getText = { it.text?.toString() },
    getContentDesc = { it.contentDescription?.toString() },
    getClickable = { it.isClickable },
    getBoundsWH = { node -> val b = Rect(); node.getBoundsInScreen(b); b.width() to b.height() },
    getChildCount = { it.childCount },
    getChild = { node, i -> node.getChild(i) },
)
