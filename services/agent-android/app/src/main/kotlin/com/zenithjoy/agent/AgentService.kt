package com.zenithjoy.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import androidx.core.app.ServiceCompat
import com.google.gson.Gson
import com.zenithjoy.agent.account.DeviceAccountModel
import com.zenithjoy.agent.account.DeviceAccountRegistry
import com.zenithjoy.agent.account.DeviceAccountScanService
import com.zenithjoy.agent.collect.CollectFailureClassifier
import com.zenithjoy.agent.collect.CollectJob
import com.zenithjoy.agent.collect.CollectReporter
import com.zenithjoy.agent.collect.CollectResult
import com.zenithjoy.agent.collect.CollectTaskQueue
import com.zenithjoy.agent.collect.CommentEntry
import com.zenithjoy.agent.collect.DmOutreachRateLimiter
import com.zenithjoy.agent.collect.DouyinCollectService
import com.zenithjoy.agent.collect.DouyinDmOutreachService
import com.zenithjoy.agent.collect.RandomDelay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Android 前台服务：Agent 核心运行时。
 *
 * 启动顺序：
 *   1. 读取 AgentConfig（licenseKey 必须已存入）
 *   2. 如未 register → 调 AgentRegistrar.register()，写入 wsToken/machineId/agentUuid
 *   3. 启动 WsClient（ws0 双通道）
 *   4. 启动 HttpHeartbeatLoop（ws1 双通道）
 */
class AgentService : Service() {

    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    private val gson = Gson()
    // 真机复现(2026-07-17)：这个客户端只服务极低频调用(报告类端点数分钟一次)，长时间
    // 空闲后 OkHttp 默认连接池里的连接会被网络切换/NAT 超时静默弄坏——复用时写入成功但
    // 读永远拿不到响应，直到 connectTimeout 才报错(见 buildReportHttpClient 注释)。
    private val httpClient = buildReportHttpClient()

    private lateinit var config: AgentConfig
    private var wsClient: WsClient? = null
    private var heartbeatLoop: HttpHeartbeatLoop? = null
    // initAgent 只允许执行一次（真机复现 2026-07-10：多次 onStartCommand 泄漏多套轮询 loop）
    @Volatile private var agentInitialized = false
    // register 重试进行中标志：onStartCommand 重试分支用它避免重复 launch 协程
    // （onStartCommand 可能因系统重启 Service 而短时间内多次交付）。注意：这个标志
    // 只覆盖"重试"这一条调用路径——真正防止 performRegister() 本身被并发执行（包括
    // initAgent() 首次调用 与 重试路径 之间的竞争）的锁是下面的 registerCallInFlight。
    @Volatile private var registerRetryInFlight = false
    // performRegister() 唯一的互斥锁，覆盖它的全部调用方（initAgent() 首次调用 +
    // onStartCommand 重试分支）。真机场景：慢网络下 initAgent() 里的首次 register 请求
    // 还没返回时，用户不耐烦连点"重启 Agent 服务"按钮触发第二次 onStartCommand——若不
    // 在这里统一加锁，两次 performRegister() 会并发打 /api/agent/register 并非原子地
    // 写同一份 SharedPreferences（wsToken/machineId/tier/agentUuid），且恰好会让这次
    // bug 本身的诱因（License 装机配额限制）更容易被触发。
    private val registerCallInFlight = java.util.concurrent.atomic.AtomicBoolean(false)
    private var collectPollLoop: AcquisitionCollectPollLoop? = null
    private var accountScanLoopJob: kotlinx.coroutines.Job? = null

    private val collectTaskQueue = CollectTaskQueue()
    private var reporter: CollectReporter? = null
    // 跨关键词聚合视频（taskId → 视频列表）
    private val stage1Accumulator = mutableMapOf<String, MutableList<CollectReporter.VideoInfo>>()
    // 跟踪每个 taskId 待完成的关键词数量（taskId → 剩余关键词 Set）
    private val stage1PendingKeywords = mutableMapOf<String, MutableSet<String>>()

    // Sprint 07052218 followup — dm_outreach 本地频控历史（发送时间戳，毫秒）。
    // 进程内存态，随 Agent 重启清零；本 sprint 先用最简单的内存实现推进真实执行路径，
    // 跨进程重启持久化频控窗口留作后续加厚项（不影响 10 分钟窗口本身的正确性判定）。
    private val dmSentTimestamps = java.util.Collections.synchronizedList(mutableListOf<Long>())

    // 真机复现(2026-07-17)：回执上报若迟迟未被确认，心跳会把同一个 task_id 原样重投递
    // 多次——本集合记录本进程生命周期内已经处理过的 dm_outreach task_id，防止重投递
    // 重复消耗频控名额、重复触发无障碍执行（见 shouldSkipDuplicateDmTask）。
    private val dmSeenTaskIds = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private val dmOutreachResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DouyinDmOutreachService.ACTION_DM_OUTREACH_RESULT) return
            val taskId = intent.getStringExtra(DouyinDmOutreachService.EXTRA_TASK_ID) ?: ""
            val status = intent.getStringExtra(DouyinDmOutreachService.EXTRA_STATUS) ?: "failed"
            val dmAssignmentId = intent.getStringExtra(DouyinDmOutreachService.EXTRA_DM_ASSIGNMENT_ID) ?: ""
            val accountLabel = intent.getStringExtra(DouyinDmOutreachService.EXTRA_ACCOUNT_LABEL) ?: ""
            val profileUrl = intent.getStringExtra(DouyinDmOutreachService.EXTRA_PROFILE_URL) ?: ""
            val errorCode = intent.getStringExtra(DouyinDmOutreachService.EXTRA_ERROR) ?: ""
            scope.launch {
                reportDmOutreachResult(taskId, status, dmAssignmentId, accountLabel, profileUrl, errorCode)
            }
        }
    }

    // Sprint 07061301-device-account-scan-wiring — 账号扫描结果广播接收，收到后调用
    // reportAccountScanResult 上报中台（本 sprint 只接线到"清晰的上报调用点"，中台写接口
    // agent_platform_sessions 的字段/端点细节不在本次合同范围内，见方法内 TODO）。
    private val accountScanResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DeviceAccountScanService.ACTION_ACCOUNT_SCAN_RESULT) return
            val requestId = intent.getStringExtra(DeviceAccountScanService.EXTRA_REQUEST_ID) ?: ""
            val ok = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_OK, false)
            val stale = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_STALE, false)
            val accountIds = intent.getStringArrayExtra(DeviceAccountScanService.EXTRA_RESULT_ACCOUNT_IDS)?.toList() ?: emptyList()
            val errorCode = intent.getStringExtra(DeviceAccountScanService.EXTRA_ERROR) ?: ""
            val screenshotB64 = intent.getStringExtra(DeviceAccountScanService.EXTRA_SCREENSHOT_B64)
            val treeDump = intent.getStringExtra(DeviceAccountScanService.EXTRA_TREE_DUMP)
            // 网络请求不能跑主线程(NetworkOnMainThreadException)，跟 warmupResultReceiver 同套路。
            scope.launch(Dispatchers.IO) { reportAccountScanResult(requestId, ok, stale, accountIds, errorCode, screenshotB64, treeDump) }
        }
    }

    // Line02 warmup — 养号验活结果广播接收，收到后 POST /api/agent/burner/warmup-result 上报中台。
    private val warmupResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DeviceAccountScanService.ACTION_ACCOUNT_WARMUP_RESULT) return
            val requestId = intent.getStringExtra(DeviceAccountScanService.EXTRA_REQUEST_ID) ?: ""
            val deviceId = intent.getStringExtra(DeviceAccountScanService.EXTRA_DEVICE_ID) ?: ""
            val total = intent.getIntExtra(DeviceAccountScanService.EXTRA_WARMUP_TOTAL, 0)
            val alive = intent.getIntExtra(DeviceAccountScanService.EXTRA_WARMUP_ALIVE, 0)
            val offline = intent.getIntExtra(DeviceAccountScanService.EXTRA_WARMUP_OFFLINE, 0)
            val resultsJson = intent.getStringExtra(DeviceAccountScanService.EXTRA_WARMUP_RESULTS) ?: "[]"
            val errorCode = intent.getStringExtra(DeviceAccountScanService.EXTRA_ERROR) ?: ""
            scope.launch { reportWarmupResult(requestId, deviceId, total, alive, offline, resultsJson, errorCode) }
        }
    }

    private val collectResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            android.util.Log.i(TAG, "DEBUG collectResultReceiver.onReceive fired: action=${intent?.action}")
            if (intent?.action != DouyinCollectService.ACTION_COLLECT_RESULT) return
            val taskId = intent.getStringExtra(DouyinCollectService.EXTRA_TASK_ID) ?: ""
            val ok = intent.getBooleanExtra(DouyinCollectService.EXTRA_RESULT_OK, false)
            val commenterIds = intent.getStringArrayExtra(DouyinCollectService.EXTRA_RESULT_COMMENT_IDS) ?: emptyArray()
            val commentTexts = intent.getStringArrayExtra(DouyinCollectService.EXTRA_RESULT_COMMENT_TEXTS) ?: emptyArray()
            val douyinIds = intent.getStringArrayExtra(DouyinCollectService.EXTRA_RESULT_DOUYIN_IDS) ?: emptyArray()
            val comments = zipCommentEntries(commenterIds.toList(), commentTexts.toList(), douyinIds.toList())
            val result = CollectResult(
                ok = ok,
                keyword = "",
                comments = comments,
                error = intent.getStringExtra(DouyinCollectService.EXTRA_RESULT_ERROR) ?: "",
            )
            scope.launch { reportCollectResult(taskId, result) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        config = AgentConfig(this)
        reporter = CollectReporter(
            httpBase = config.deriveHttpBase(),
            agentId = { config.agentId },
        )

        // 真机复现(2026-07-17 xian-rog)：force-stop 重启 App 会被 Android 系统级整体关闭
        // 无障碍服务(accessibility_enabled=0)，且没有任何显式报错——DouyinCollectService/
        // DouyinDmOutreachService/DeviceAccountScanService 的任务广播照常发得出去，只是
        // 没有任何服务在监听，agent 心跳仍报 online，采集/私信/账号扫描却静默全部失效。
        // App 本身无法在不越权(WRITE_SECURE_SETTINGS 是系统权限)的情况下自动重新开启无障碍
        // 服务，能做的是让这个状态从"静默"变成"显式可观测"：启动时检查系统已启用的无障碍
        // 服务列表，缺哪个就把哪个记进错误日志，附带手动恢复命令，不再靠"广播发了没人收"
        // 这种隐蔽现象倒推排查。
        val enabledAccessibilityRaw = android.provider.Settings.Secure.getString(
            contentResolver, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        )
        val missingServices = missingAccessibilityServices(enabledAccessibilityRaw, REQUIRED_ACCESSIBILITY_SERVICES)
        if (missingServices.isNotEmpty()) {
            android.util.Log.e(
                TAG,
                "无障碍服务未全部启用(force-stop 重启后常见现象)——以下服务不在系统已启用列表，" +
                    "对应功能(采集/私信/账号扫描)将静默失效直到手动或 adb 重新开启: $missingServices\n" +
                    "恢复命令: adb shell settings put secure enabled_accessibility_services " +
                    "${REQUIRED_ACCESSIBILITY_SERVICES.joinToString(":")} " +
                    "&& adb shell settings put secure accessibility_enabled 1",
            )
        }

        startForegroundCompat()
        registerReceiver(collectResultReceiver,
            IntentFilter(DouyinCollectService.ACTION_COLLECT_RESULT),
            RECEIVER_NOT_EXPORTED)
        registerReceiver(dmOutreachResultReceiver,
            IntentFilter(DouyinDmOutreachService.ACTION_DM_OUTREACH_RESULT),
            RECEIVER_NOT_EXPORTED)
        registerReceiver(accountScanResultReceiver,
            IntentFilter(DeviceAccountScanService.ACTION_ACCOUNT_SCAN_RESULT),
            RECEIVER_NOT_EXPORTED)
        registerReceiver(warmupResultReceiver,
            IntentFilter(DeviceAccountScanService.ACTION_ACCOUNT_WARMUP_RESULT),
            RECEIVER_NOT_EXPORTED)

        // 真机实测确认(2026-07-09)：DouyinCollectService 的 ACTION_COLLECT_RESULT
        // 广播在这台荣耀真机上发得出去(sendBroadcast 正常返回)，但 collectResultReceiver
        // 从未收到——广播这条路不可靠，原因未查清(疑似 MagicOS 后台广播限流)。改用
        // 同进程直接回调作为主路径，broadcast 只留兜底。
        DouyinCollectService.onCollectResult = { taskId, ok, commentIds, commentTexts, douyinIds, error ->
            val comments = zipCommentEntries(commentIds, commentTexts, douyinIds)
            val result = CollectResult(ok = ok, keyword = "", comments = comments, error = error)
            scope.launch { reportCollectResult(taskId, result) }
        }

        // Stage1 视频卡回调：聚合视频，全部关键词完成后 POST /collect/report-videos
        DouyinCollectService.onVideoCardResult = { taskId, keyword, videos, error ->
            val videoInfos = videos.map { v ->
                CollectReporter.VideoInfo(
                    video_id = v.videoId,
                    keyword = v.keyword,
                    title = v.title,
                    shareUrl = v.shareUrl,
                )
            }
            synchronized(stage1Accumulator) {
                stage1Accumulator.getOrPut(taskId) { mutableListOf() }.addAll(videoInfos)
                stage1PendingKeywords[taskId]?.remove(keyword)
                val remaining = stage1PendingKeywords[taskId]?.size ?: 0
                if (remaining == 0) {
                    val allVideos = stage1Accumulator.remove(taskId) ?: emptyList()
                    stage1PendingKeywords.remove(taskId)
                    scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                        reporter?.reportVideos(
                            taskId = taskId,
                            videos = allVideos,
                            searchResultEmpty = allVideos.isEmpty() && error.isEmpty(),
                            errorCode = if (error.isNotEmpty()) error else null,
                        )
                        collectTaskQueue.markCurrentDone()
                        processNextQueuedTask()
                    }
                } else {
                    collectTaskQueue.markCurrentDone()
                    processNextQueuedTask()
                }
            }
        }

        // dispatch 投递保障（真机复现 2026-07-10 两种死锁）：
        // ① busy 拒绝——服务在忙，任务被丢；② 广播进虚空——无障碍服务未 connected，
        // receiver 未注册，连拒绝都没有。两种都靠"超时未 ack → 看门狗重试"统一自愈
        // （见 dispatchJob 的 startDispatchAckWatchdog），拒绝回执只留日志观测。
        DouyinCollectService.onTaskAccepted = { acceptedTaskId ->
            if (collectTaskQueue.currentJob?.taskId == acceptedTaskId) {
                collectTaskQueue.markCurrentAccepted()
            }
        }
        DouyinCollectService.onTaskRejected = { rejectedTaskId ->
            android.util.Log.w(TAG, "queue: dispatch rejected(busy) taskId=$rejectedTaskId — ack watchdog will retry")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!config.isConfigured) {
            android.util.Log.w(TAG, "licenseKey not set — agent cannot start")
            stopSelf()
            return START_NOT_STICKY
        }
        // 用户可能在服务已运行期间才在 MainActivity 完成 MediaProjection 授权（先「启动
        // Agent」跳过截屏授权，后来又点「授权截屏」）。startForeground 可重复调用以更新
        // type，这里重跑一次把已授权的服务从纯 DATA_SYNC 升级到 DATA_SYNC|MEDIA_PROJECTION，
        // 不需要重启整个服务。
        startForegroundCompat()
        // 真机复现(2026-07-10)：lastStartId=3 → initAgent 跑了 3 次，泄漏 3 套轮询
        // loop（旧 loop 只在 onDestroy 停），同一任务每周期被投递 N 次。只初始化一次。
        if (shouldRunInitAgent(agentInitialized)) {
            agentInitialized = true
            scope.launch { initAgent() }
        } else if (shouldRetryRegister(config.isRegistered, registerRetryInFlight)) {
            // 真机复现(2026-07-20)：register 失败后（如撞配额上限），agentInitialized 已
            // 为 true，initAgent() 不会再跑，register() 也就永远没有第二次机会——"重启
            // Agent 服务"按钮点了等于白点。这里独立于 agentInitialized 重试注册，不重新
            // 初始化 WS/心跳轮询 loop（避免重新触发 2026-07-10 那个泄漏）。
            registerRetryInFlight = true
            scope.launch {
                try {
                    performRegister()
                } finally {
                    registerRetryInFlight = false
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        wsClient?.stop()
        heartbeatLoop?.stop()
        collectPollLoop?.stop()
        accountScanLoopJob?.cancel()
        serviceJob.cancel()
        unregisterReceiver(collectResultReceiver)
        unregisterReceiver(dmOutreachResultReceiver)
        unregisterReceiver(accountScanResultReceiver)
        unregisterReceiver(warmupResultReceiver)
        DouyinCollectService.onCollectResult = null
        DouyinCollectService.onVideoCardResult = null
        sharedScreenCaptureService = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun initAgent() {
        // 计算机器指纹（首次）
        if (config.machineId.isEmpty()) {
            config.machineId = MachineFingerprint.compute(this)
        }
        // 生成 agentId（首次）
        if (config.agentId.isEmpty()) {
            val slug = MachineFingerprint.hostnameSlug()
            config.agentId = "agent-$slug-${System.currentTimeMillis().toString(36)}"
        }

        // License 注册（复用 POST /api/agent/register）
        performRegister()

        // WS 客户端（ws0 协议，15s heartbeat）
        wsClient = WsClient(
            config = config,
            scope = scope,
            onMessage = { type, payload ->
                android.util.Log.d(TAG, "ws0 message: $type")
                if (type == "collect_task") routeCollectTask(payload)
            },
        )
        wsClient?.start()

        // HTTP 心跳循环（ws1 协议，30s interval）
        heartbeatLoop = HttpHeartbeatLoop(
            params = config.toHeartbeatParams(android.os.Build.MODEL),
            scope = scope,
            onTask = { task ->
                android.util.Log.i(TAG, "ws1 task: ${task.platform} id=${task.task_id} type=${task.type}")
                val payloadTaskType = task.payload["task_type"] as? String
                if (shouldRouteWarmup(payloadTaskType)) {
                    // Line02 warmup：中台每日下发的养号验活任务（判别符走 payload.task_type）。
                    val operatorNickname = task.payload["operator_nickname"] as? String ?: ""
                    android.util.Log.i(TAG, "ws1 warmup task: id=${task.task_id} operator=$operatorNickname")
                    DeviceAccountScanService.dispatchWarmupTask(
                        this@AgentService, task.task_id, config.machineId, operatorNickname,
                    )
                } else if (task.platform == "android_douyin") {
                    val keyword = task.payload["keyword"] as? String ?: ""
                    if (keyword.isNotBlank()) {
                        DouyinCollectService.dispatchTask(this@AgentService, keyword, task.task_id)
                    }
                } else if (shouldRouteDmOutreach(payloadTaskType)) {
                    routeDmOutreachTask(task)
                } else if (shouldRouteAccountScan(payloadTaskType)) {
                    // 手动触发的立即扫描：直接复用既有 dispatchTask，DeviceAccountScanService
                    // 内部已有 state != State.IDLE 早退判断，与内部 30-60 分钟循环天然互斥，
                    // 不需要额外去重逻辑（sprint 07192358）。
                    android.util.Log.i(TAG, "ws1 account_scan task (manual trigger): id=${task.task_id}")
                    DeviceAccountScanService.dispatchTask(
                        this@AgentService, task.task_id, tenantId = "", thisDeviceId = config.machineId,
                    )
                }
            },
            onHeartbeat = { resp ->
                android.util.Log.d(TAG, "ws1 heartbeat ok, agent_id=${resp.agent_id}")
            },
            onAgentIdReceived = { agentId ->
                if (config.agentId.isEmpty() || config.agentId != agentId) {
                    config.agentId = agentId
                }
            },
        )
        heartbeatLoop?.start()

        // reporter 使用最新 agentId（initAgent 之后才确定）
        reporter = CollectReporter(
            httpBase = config.deriveHttpBase(),
            agentId = { config.agentId },
        )

        // 两阶段采集任务轮询（Path 2 Step 5）
        // 真实截图实现：用 MediaProjectionHolder 换出的 MediaProjection 实例构造
        // captureImpl（VirtualDisplay + ImageReader，见 ScreenCaptureReal）。若用户还
        // 没在 MainActivity 里授权过（hasAuthorization()==false），换出结果恒为 null，
        // ScreenCaptureService.captureToBase64() 相应恒返回 null——ContentJudgmentService
        // 会标 pending/skipped_capture_failed，不阻塞采集主链路，只是内容判定这一刀空转。
        // 状态自检：授权状态可在 MainActivity 状态页里看到（"截图未授权"横幅）。
        if (!MediaProjectionHolder.hasAuthorization()) {
            android.util.Log.w(TAG, "MediaProjection not authorized yet — content judgment will stay pending until user authorizes in app UI")
        }
        val screenCaptureService = ScreenCaptureService(
            captureImpl = ScreenCaptureReal.buildCaptureImpl(this) {
                MediaProjectionHolder.getOrCreateProjection(this)
            },
        )
        // 进程内唯一 ScreenCaptureService 共享引用（sprint 07201209 whole-branch review 修复）：
        // ScreenCaptureReal 是进程级单例 object，manager 字段全局唯一——绝不能有第二个调用点
        // 各自 new 一个 ScreenCaptureService（会撞上 A14 CaptureSessionManager 单例纪律，重复
        // createVirtualDisplay 崩溃并殃及本类下面 ContentJudgmentService 的截图能力）。
        // DeviceAccountScanService.captureFailureDiagnostics() 复用这个共享引用，不再自建实例。
        sharedScreenCaptureService = screenCaptureService
        // 用户2026-07-17拍板（判定点1d078987）：视频类内容判定改用真实音频转写，固定录制
        // 开头20秒系统音频（AudioRecordService.RECORD_DURATION_MS）。复用同一个 MediaProjection
        // 授权换出实例，不额外弹权限框。
        val audioCaptureService = AudioCaptureService(
            captureImpl = {
                MediaProjectionHolder.getOrCreateProjection(this)
                    ?.let { AudioRecordService(it).captureAudioSnippet() }
            },
        )
        val judgmentService = ContentJudgmentService(
            agentId = { config.agentId },
            httpBase = config.deriveHttpBase(),
            // tenantId 由服务端按 agent_id 反查，设备端不持有；/judge-video 服务端兼容 header 反查
            tenantId = { config.agentId },
            screenCaptureService = screenCaptureService,
            audioCaptureService = audioCaptureService,
        )
        collectPollLoop = AcquisitionCollectPollLoop(
            agentId = { config.agentId },
            httpBase = config.deriveHttpBase(),
            scope = scope,
            contentJudgmentService = judgmentService,
            // 判决门截图前打开视频（Brain issue 2b85b616 修复）：深链打开目标视频 +
            // 固定导航等待，保证 judgmentService 截图时屏幕上是这个视频，不是搜索结果页。
            // 复用与 DouyinCollectService.launchVideoByDeepLink 相同的 URI scheme。
            // pollOnce() 跑在 Dispatchers.IO 协程里，Thread.sleep 不阻塞主线程。
            videoOpener = { videoId ->
                try {
                    val uri = Uri.parse("snssdk1128://aweme/detail/$videoId")
                    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    applicationContext.startActivity(intent)
                    Thread.sleep(RandomDelay.sample(RandomDelay.NAV_MS))
                } catch (e: Exception) {
                    android.util.Log.e(TAG, "judgment videoOpener deeplink failed videoId=$videoId: ${e.message}")
                }
            },
            onStage1Task = { taskId, keyword ->
                android.util.Log.i(TAG, "collect stage_1 task: id=$taskId keyword=$keyword")
                // 追踪该 taskId 的关键词，入队 Stage1 Job
                // 锁对象统一用 stage1Accumulator（与 onVideoCardResult / reportCollectResult 一致），
                // 两把锁保护同一组 map 等于没锁。
                synchronized(stage1Accumulator) {
                    stage1PendingKeywords.getOrPut(taskId) { mutableSetOf() }.add(keyword)
                    stage1Accumulator.getOrPut(taskId) { mutableListOf() }
                }
                collectTaskQueue.enqueue(CollectJob.Stage1(taskId, keyword))
                processNextQueuedTask()
            },
            onStage2Task = { taskId, videoUrls, _ ->
                android.util.Log.i(TAG, "collect stage_2 task: id=$taskId videos=${videoUrls.size}")
                // 对每个视频 URL 入队 Stage2 Job
                videoUrls.forEach { videoUrl ->
                    val videoId = extractVideoId(videoUrl)
                    if (videoId == null) {
                        // Bug C：服务端解析失败的 URL 不会有真实数字 id，绝不用 hash 造假 id
                        // （造假 id 深链必打不开），直接跳过。
                        android.util.Log.w(TAG, "stage2: skip URL without numeric id: $videoUrl")
                    } else {
                        collectTaskQueue.enqueue(CollectJob.Stage2(taskId, videoUrl, videoId))
                    }
                }
                processNextQueuedTask()
            },
            onCancel = { taskId ->
                android.util.Log.i(TAG, "collect task cancelled: id=$taskId")
                collectTaskQueue.enqueue(CollectJob.Cancel(taskId))
                processNextQueuedTask()
            },
        )
        collectPollLoop?.start()

        // Sprint 07061301-device-account-scan-wiring — 定时触发设备账号扫描（30-60 分钟随机间隔，
        // 与 RandomDelay 一样禁止用固定常量），扫描服务自身会先判互斥锁再决定是否真的执行。
        accountScanLoopJob = scope.launch { runAccountScanLoop() }

        android.util.Log.i(TAG, "agent started — agentId=${config.agentId} machineId=${config.machineId}")
    }

    /**
     * 注册一次（复用 POST /api/agent/register）。从 initAgent() 抽出，使其能独立于
     * agentInitialized 被重复调用——register 失败后（如撞 License 装机配额上限），
     * 后续 onStartCommand（重启按钮/系统重启 Service）能真正重试，不需要杀进程重开。
     */
    private suspend fun performRegister() {
        if (config.isRegistered) {
            android.util.Log.i(TAG, "already registered, skipping")
            return
        }
        if (!registerCallInFlight.compareAndSet(false, true)) {
            android.util.Log.i(TAG, "performRegister already in flight, skipping duplicate call")
            return
        }
        try {
            android.util.Log.i(TAG, "registering with license...")
            try {
                val registrar = AgentRegistrar()
                val registerRequest = AgentRegistrar.RegisterRequest(
                    licenseKey = config.licenseKey,
                    machineId = config.machineId,
                    hostname = android.os.Build.MODEL,
                    agentId = config.agentId,
                    version = BuildConfig.VERSION_NAME,
                    httpBase = config.deriveHttpBase(),
                )
                when (val outcome = withContext(Dispatchers.IO) { registrar.register(registerRequest) }) {
                    is AgentRegistrar.RegisterOutcome.Success -> {
                        val result = outcome.result
                        config.wsToken = result.wsToken
                        config.machineId = result.machineId
                        if (!result.tier.isNullOrEmpty()) config.tier = result.tier
                        if (!result.agentUuid.isNullOrEmpty()) config.agentUuid = result.agentUuid
                        config.lastRegisterError = ""
                        android.util.Log.i(TAG, "registered — tier=${config.tier} uuid=${config.agentUuid}")
                    }
                    is AgentRegistrar.RegisterOutcome.Failure -> {
                        config.lastRegisterError = outcome.reason
                        android.util.Log.w(TAG, "registration failed: ${outcome.reason} — continuing with license key fallback")
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // 协程取消不是"注册失败"，必须原样上抛，否则破坏结构化并发（父作用域/scope 取消
                // 时子协程应该真正终止，而不是被这里当普通异常吞掉）。
                throw e
            } catch (e: Exception) {
                // 兜底：AgentRegistrar.register() 只 catch IOException，Gson/OkHttp 内部的非
                // IOException RuntimeException 等意外异常会从这里逃逸。performRegister() 现在
                // 可能被"重启 Agent 服务"按钮反复触发（见 shouldRetryRegister），调用方 scope
                // 无 CoroutineExceptionHandler——不兜底就会变成"点按钮→进程崩溃→再点→再崩溃"
                // 的循环，而不是安全地把失败原因写进 lastRegisterError（同 RegisterOutcome.Failure
                // 分支的处理方式一致）。
                config.lastRegisterError = "注册时发生意外错误：${e.message ?: e::class.simpleName}"
                android.util.Log.w(TAG, "performRegister unexpected error: ${e.message}", e)
            }
        } finally {
            registerCallInFlight.set(false)
        }
    }

    /** 从 Job 队列取下一个任务并派发执行（顺序执行，当前任务完成后才取下一个）。 */
    private fun processNextQueuedTask() {
        if (collectTaskQueue.currentJob != null) return // 已有任务在跑
        val next = collectTaskQueue.pollNext() ?: return
        dispatchJob(next)
    }

    private fun dispatchJob(next: CollectJob) {
        when (next) {
            is CollectJob.Stage1 -> {
                android.util.Log.i(TAG, "queue: dispatching Stage1 taskId=${next.taskId} keyword=${next.keyword}")
                DouyinCollectService.dispatchTask(this@AgentService, next.keyword, next.taskId)
                startDispatchAckWatchdog(next)
            }
            is CollectJob.Stage2 -> {
                android.util.Log.i(TAG, "queue: dispatching Stage2 taskId=${next.taskId} videoId=${next.videoId}")
                DouyinCollectService.dispatchStage2Task(this@AgentService, next.videoUrl, next.videoId, next.taskId)
                startDispatchAckWatchdog(next)
            }
            is CollectJob.Cancel -> {
                android.util.Log.i(TAG, "queue: dispatching Cancel taskId=${next.taskId}")
                scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    reporter?.reportCancel(next.taskId)
                    collectTaskQueue.markCurrentDone()
                    processNextQueuedTask()
                }
            }
        }
    }

    /**
     * dispatch ack 看门狗：广播派发后若超时仍未收到接受方 ack（无障碍服务未
     * connected 时广播进虚空，或 busy 拒绝），重发 dispatch；重试超限后放弃该
     * job 让队列继续推进，避免 currentJob 永久卡死。
     */
    private fun startDispatchAckWatchdog(job: CollectJob) {
        scope.launch {
            delay(DISPATCH_RETRY_DELAY_MS)
            if (collectTaskQueue.currentJob != job || collectTaskQueue.currentAccepted) return@launch
            if (collectTaskQueue.retryCurrent(MAX_DISPATCH_RETRIES)) {
                android.util.Log.w(TAG, "queue: dispatch not acked in ${DISPATCH_RETRY_DELAY_MS}ms, retrying taskId=${job.taskId}")
                dispatchJob(job)
            } else {
                android.util.Log.w(TAG, "queue: dispatch retries exhausted — dropping job taskId=${job.taskId}")
                collectTaskQueue.markCurrentDone()
                processNextQueuedTask()
            }
        }
    }

    /**
     * 从 Douyin 深链 URL 提取真实视频/图文 ID（纯数字）。
     * 如 ".../video/7123456789" 或 ".../note/7123456789" → "7123456789"。
     * Bug C：提取不到就返回 null（调用方跳过该 URL），绝不用 hash 造假 id。
     */
    private fun extractVideoId(videoUrl: String): String? {
        val match = Regex("/(?:video|note)/(\\d+)").find(videoUrl)
        return match?.groupValues?.get(1)
    }

    private suspend fun runAccountScanLoop() {
        while (scope.isActive) {
            delay(sampleAccountScanIntervalMs())
            val requestId = "scan-${System.currentTimeMillis().toString(36)}"
            // tenantId 本地未持有真实值（接缝清单第 4 条：tenantId 不得信任设备上报，
            // 必须服务端按 agent_id 反查）——这里只作为扫描内部临时上下文占位符，
            // reportAccountScanResult 上报中台时禁止使用此字段冒充真实 tenantId。
            DeviceAccountScanService.dispatchTask(this@AgentService, requestId, tenantId = "", thisDeviceId = config.machineId)
        }
    }

    private fun sampleAccountScanIntervalMs(): Long = Random.nextLong(30 * 60_000L, 60 * 60_000L + 1)

    /**
     * Android 14（API 34）要求：foreground service 若声明多个 type（本服务是
     * dataSync|mediaProjection，见 AndroidManifest.xml），startForeground() 必须显式
     * 传入本次要用到的 type 组合，否则截图相关调用会抛 MissingForegroundServiceTypeException/
     * SecurityException。API 29 以下没有这个重载，走旧的双参数 startForeground。
     * ServiceCompat.startForeground 内部按 SDK 版本自动分派，minSdk 26 兼容安全。
     *
     * 真机复现(2026-07-13 Honor xian-rog)：MEDIA_PROJECTION type 必须已持有有效授权令牌，
     * 否则系统直接 SecurityException 杀死整个服务——不能无条件声明两种 type，必须按
     * MediaProjectionHolder.hasAuthorization() 动态决定（见 foregroundServiceTypeFlags）。
     */
    private fun startForegroundCompat() {
        // ServiceCompat.startForeground 内部按 SDK 版本自动分派（<29 直接忽略 type 参数走
        // 双参数 startForeground；29-33 部分强制 type 校验；34+ 完整校验），不用手动分支。
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(),
            foregroundServiceTypeFlags(MediaProjectionHolder.hasAuthorization()),
        )
    }

    private fun buildNotification(): Notification {
        val channelId = "agent_service"
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(channelId) == null) {
            val channel = NotificationChannel(
                channelId,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            )
            manager.createNotificationChannel(channel)
        }
        return Notification.Builder(this, channelId)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build()
    }

    private fun routeCollectTask(payload: Map<*, *>) {
        val keyword = payload["keyword"] as? String ?: return
        val taskId = payload["task_id"] as? String ?: ""
        if (keyword.isBlank()) return
        android.util.Log.i(TAG, "ws0 collect_task keyword=$keyword id=$taskId")
        DouyinCollectService.dispatchTask(this, keyword, taskId)
    }

    // Sprint 07052218 followup — dm_outreach 任务路由：先本地频控自检（DmOutreachRateLimiter,
    // 10 分钟窗口 ≤3 条），超限直接构造 limited 结果广播上报，不启动无障碍执行流程；
    // 未超限才真正 dispatchTask 给 DouyinDmOutreachService 走无障碍打开主页→点私信→发送流程。
    private fun routeDmOutreachTask(task: HttpHeartbeatLoop.HeartbeatTask) {
        // 真机复现(2026-07-17)：回执上报若迟迟未被服务端确认(如连接池超时)，任务会永远
        // 停在 queued，心跳每~30s 就把同一个 task_id 原样重投递——不去重的话每次投递都
        // 会重新消耗频控名额，几次幽灵重投递就能占满整个窗口，连累完全无关的新任务被
        // 误判 rate-limited。本进程生命周期内已处理过的 task_id 直接跳过。
        if (shouldSkipDuplicateDmTask(task.task_id, dmSeenTaskIds)) {
            android.util.Log.i(TAG, "dm_outreach task ${task.task_id} already seen this session — skip duplicate redelivery")
            return
        }
        dmSeenTaskIds.add(task.task_id)

        // Seg3 方案 B′：搜索目标取 douyin_id（裸抖音号），不是 profile_url。
        // DouyinDmOutreachService 把收到的字段当抖音号往搜索框里搜——喂 URL 必然 NO_MATCH。
        // payload 里的 profile_url 是给 Windows 通道 page.goto 用的，语义相反，不可混用。
        val targetDouyinId = extractDmTargetDouyinId(task.payload)
        val message = task.payload["message"] as? String ?: ""
        val accountLabel = task.payload["account_label"] as? String ?: ""
        val dmAssignmentId = task.payload["dm_assignment_id"] as? String ?: ""
        if (targetDouyinId == null || message.isBlank()) {
            android.util.Log.w(TAG, "dm_outreach task ${task.task_id} missing douyin_id/message — skip")
            return
        }

        // Golden Path Step 7：派发前一致性核对。
        //
        // 2026-07-06 复查结论（放弃"按account_label精确核对"）：task.payload["account_label"]
        // 是中台绑定小号时用户自己起的任意字符串（apps/api/src/routes/agent-burner.ts
        // initiate-bind），跟 DeviceAccountRegistry 的 key（扫描面板读到的真实抖音号 douyinId）
        // 是两套完全独立的命名空间——绑定链路和 agent_platform_sessions 表都没有任何字段把
        // 两者关联起来，按 account_label 去 registry 里查永远查不到记录，guard 会因为
        // "未扫描到过默认放行"而恒为 PROCEED，一致性核对形同虚设。
        //
        // 降级为诚实的近似判定：核对对象改成"本机（config.machineId）本轮扫描是否至少还有
        // 一个账号在线"——本机所有已知账号全部下线才触发重扫+本次任务转失败；只要有一个在线
        // （或本机从未扫描到过账号）就放行。这不能保证"本次派发要用的那一个账号"精确在线，
        // 只能保证"这台设备不是已知全灭"，是已知的架构空白（详见
        // DeviceAccountScanService.checkDispatchConsistency 函数注释）；真正的精确核对要等
        // 账号绑定链路补上 account_label → douyinId 映射后才能升级。
        val dispatchDecision = DeviceAccountScanService.checkDispatchConsistency(config.machineId)
        if (dispatchDecision == DeviceAccountModel.DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL) {
            android.util.Log.w(TAG, "dm_outreach task ${task.task_id} account=$accountLabel recorded offline at dispatch — triggering rescan, failing task")
            DeviceAccountScanService.dispatchTask(this, "rescan-${task.task_id}", tenantId = "", thisDeviceId = config.machineId)
            reportDmOutreachResult(task.task_id, "failed", dmAssignmentId, accountLabel, targetDouyinId, "ACCOUNT_OFFLINE_AT_DISPATCH")
            return
        }

        val now = System.currentTimeMillis()
        val withinLimit = DmOutreachRateLimiter.isWithinLimit(dmSentTimestamps.toList(), now)
        if (!withinLimit) {
            android.util.Log.w(TAG, "dm_outreach task ${task.task_id} rate-limited — reporting limited without dispatch")
            DouyinDmOutreachService.dispatchRateLimited(
                this, task.task_id, dmAssignmentId, accountLabel, targetDouyinId,
            )
            return
        }
        dmSentTimestamps.add(now)
        DouyinDmOutreachService.dispatchTask(
            this, targetDouyinId, message, task.task_id, dmAssignmentId, accountLabel,
        )
    }

    // Sprint 07061301-device-account-scan-wiring — 账号扫描结果上报调用点。
    //
    // TODO(中台对接，超出本 sprint 合同范围): 目前只打印日志，未真实调用中台接口写回
    // `agent_platform_sessions`（`device_type='android'` + 账号列表相关字段）。真实实现时：
    //   1. 必须新增/复用一个 `/api/agent/...` 端点（未在本 sprint contract-draft.md 定义）。
    //   2. tenantId 绝不能用本地 dispatchTask 传的占位值——必须由服务端按 agent_id 反查
    //      （见 sprints/07061204-android-device-account-model/contract-draft.md 接缝清单第 4 条，
    //      对齐"同机双租户 deny"修复的严格程度）。
    //   3. `shouldInvalidateOldDeviceRecord`/`shouldLogConflictAlert` 为 true 的账号，服务端
    //      落库时要真正执行"标失效"写操作和"写日志告警"动作（本 sprint 只在扫描服务本地做
    //      了判定与 Log.w 级别的告警打印，DB 落地是中台职责）。
    private fun reportAccountScanResult(
        requestId: String,
        ok: Boolean,
        stale: Boolean,
        accountIds: List<String>,
        errorCode: String,
        screenshotB64: String? = null,
        treeDump: String? = null,
    ) {
        val url = "${config.deriveHttpBase()}/api/agent/burner/account-scan-result"
        val body = buildAccountScanResultBody(requestId, config.agentId, ok, stale, accountIds, errorCode, screenshotB64, treeDump)
        try {
            val request = Request.Builder()
                .url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            httpClient.newCall(request).execute().use { resp ->
                android.util.Log.i(
                    TAG,
                    "account-scan-result reported: ${resp.code} requestId=$requestId accountCount=${accountIds.size}",
                )
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "account-scan-result report failed: ${e.message}")
        }
    }

    // dm_outreach 结果上报（扩展现有 /api/agent/burner/dm-outreach-result 端点，
    // 新增 device_platform="android" — sprints/07052218-douyin-dm-outreach-android/contract-draft.md）。
    private fun reportDmOutreachResult(
        taskId: String,
        status: String,
        dmAssignmentId: String,
        accountLabel: String,
        profileUrl: String,
        errorCode: String,
    ) {
        if (taskId.isEmpty()) return
        val url = "${config.deriveHttpBase()}/api/agent/burner/dm-outreach-result"
        val body = buildMap<String, Any?> {
            put("task_id", taskId)
            put("agent_id", config.agentId)
            put("account_label", accountLabel)
            put("status", status)
            put("profile_url", profileUrl)
            put("device_platform", "android")
            if (dmAssignmentId.isNotBlank()) put("dm_assignment_id", dmAssignmentId)
            if (errorCode.isNotBlank()) put("error_code", errorCode)
        }
        try {
            val request = Request.Builder()
                .url(url)
                .post(gson.toJson(body).toRequestBody("application/json".toMediaType()))
                .build()
            httpClient.newCall(request).execute().use { resp ->
                android.util.Log.i(TAG, "dm-outreach-result reported: ${resp.code} task=$taskId status=$status")
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "dm-outreach-result report failed: ${e.message}")
        }
    }

    // Line02 warmup 结果上报（新端点 /api/agent/burner/warmup-result，中台设备级按真实昵称写库）。
    // agentId 用 config.agentId（服务端仍按 task_id 反查 tenant，不信设备上报的 tenant）。
    private fun reportWarmupResult(
        requestId: String,
        deviceId: String,
        total: Int,
        alive: Int,
        offline: Int,
        resultsJson: String,
        errorCode: String,
    ) {
        if (requestId.isEmpty()) return
        val url = "${config.deriveHttpBase()}/api/agent/burner/warmup-result"
        val body = buildWarmupResultBody(requestId, deviceId, config.agentId, total, alive, offline, resultsJson, errorCode)
        try {
            val request = Request.Builder()
                .url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            httpClient.newCall(request).execute().use { resp ->
                android.util.Log.i(TAG, "warmup-result reported: ${resp.code} req=$requestId total=$total alive=$alive offline=$offline err=$errorCode")
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "warmup-result report failed: ${e.message}")
        }
    }

    // taskId 对应 acquisition_keyword_tasks.id（由 ws0/ws1 派发 android_douyin 任务时下发）。
    // /api/agent/task-result 端点不存在——服务端唯一能接住评论数据的是已有的
    // /api/acquisition/comment-score-result（Windows Agent 已在用同一端点，字段一致）。
    // 路由判断：collectPollLoop.collectTaskIds 命中 → 新协议 /collect/report，否则旧协议。
    private fun reportCollectResult(taskId: String, result: CollectResult) {
        android.util.Log.i(TAG, "DEBUG reportCollectResult called: taskId=$taskId")
        if (taskId.isEmpty()) return

        val isCollectTask = collectPollLoop?.collectTaskIds?.contains(taskId) == true
        if (isCollectTask) {
            val currentJob = collectTaskQueue.currentJob
            if (currentJob is CollectJob.Stage1) {
                // Stage1 结果走 DouyinCollectService.onVideoCardResult 回调，不走此路径
                // 此分支是 DouyinCollectService 搜索失败（finishWithError）时的兜底上报
                val errorCode = if (result.error.isNotEmpty()) result.error else "SEARCH_FAILED"
                synchronized(stage1Accumulator) {
                    stage1PendingKeywords[taskId]?.remove(currentJob.keyword)
                    val remaining = stage1PendingKeywords[taskId]?.size ?: 0
                    if (remaining == 0) {
                        val videos = stage1Accumulator.remove(taskId) ?: emptyList()
                        stage1PendingKeywords.remove(taskId)
                        scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                            reporter?.reportVideos(
                                taskId,
                                videos,
                                errorCode = if (videos.isEmpty()) CollectFailureClassifier.classify(errorCode) else null,
                            )
                            collectTaskQueue.markCurrentDone()
                            processNextQueuedTask()
                        }
                    } else {
                        collectTaskQueue.markCurrentDone()
                        processNextQueuedTask()
                    }
                }
            } else if (currentJob is CollectJob.Stage2) {
                // Stage2：评论抓取完成，上报 report
                val commenters = result.comments.map { it.toCollectReportMap() }
                scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    reporter?.reportCollect(
                        taskId = taskId,
                        videoId = currentJob.videoId,
                        commenters = commenters,
                        terminal = collectTaskQueue.isEmpty(),
                    )
                    collectTaskQueue.markCurrentDone()
                    processNextQueuedTask()
                }
            } else {
                // 兼容旧路径（无队列任务时）
                reportCollectReportNew(taskId, result)
                collectTaskQueue.markCurrentDone()
                processNextQueuedTask()
            }
        } else {
            // 旧协议：/api/acquisition/comment-score-result
            val url = "${config.deriveHttpBase()}/api/acquisition/comment-score-result"
            val body = gson.toJson(result.toCommentScoreResultPayload(taskId))
            try {
                val request = Request.Builder()
                    .url(url)
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(request).execute().use { resp ->
                    android.util.Log.i(TAG, "comment-score-result reported: ${resp.code} task=$taskId")
                }
            } catch (e: Exception) {
                android.util.Log.w(TAG, "comment-score-result report failed: ${e.message}")
            }
        }
    }

    // 新协议上报（兼容旧调用路径，不带 reporter）：POST /api/acquisition/collect/report
    private fun reportCollectReportNew(taskId: String, result: CollectResult, terminal: Boolean = false, partialReason: String? = null) {
        if (taskId.isEmpty()) return
        val commenters = result.comments.map { it.toCollectReportMap() }
        val videoId = taskId + "_" + System.currentTimeMillis().toString(36)
        scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            reporter?.reportCollect(
                taskId = taskId,
                videoId = videoId,
                commenters = commenters,
                terminal = terminal,
                partialReason = partialReason,
            )
        }
    }

    companion object {
        private const val TAG = "AgentService"
        private const val NOTIFICATION_ID = 1001

        /**
         * 进程内唯一 ScreenCaptureService 共享引用（sprint 07201209）。onCreate 里构造完唯一实例后
         * 赋值给这个字段，供 DeviceAccountScanService.captureFailureDiagnostics() 等跨类调用点复用，
         * 避免各自 new 出第二个 ScreenCaptureService（进而撞上 ScreenCaptureReal 进程级单例
         * CaptureSessionManager 的"同一 projection 不能二次 createVirtualDisplay"纪律）。
         * onDestroy 里清空，避免持有已失效底层 MediaProjection/CaptureSessionManager 的陈旧引用。
         */
        @Volatile
        var sharedScreenCaptureService: ScreenCaptureService? = null

        /**
         * 构造供 dm-outreach-result / warmup-result 等低频报告类端点使用的 OkHttpClient。
         * 真机复现(2026-07-17 xian-rog)：这类调用数分钟才发生一次，OkHttp 默认连接池
         * （最多 5 条空闲连接、保留 5 分钟）会在这段空闲期间遇到网络切换/NAT 超时，
         * 静默弄坏池里的连接——下次复用时写入成功但读永远拿不到响应，直到 connectTimeout
         * 才报错（而非快速失败重连）。HttpHeartbeatLoop 用的是【独立的】OkHttpClient 实例，
         * 靠自己每 30s 一次的高频调用让连接保持常新，从不复用到静默失效的连接——这正是
         * "心跳一直正常、回执一直 timeout"的原因。maxIdleConnections=0 让这个低频客户端
         * 每次调用都开新连接，不留旧连接可复用，从根上消除这整类"复用僵尸连接"的问题；
         * 调用频率本身极低，多付的一次握手开销可忽略。
         */
        internal fun buildReportHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
            .build()

        // Line02 warmup 判别符：中台 INSERT publish_tasks 时把 task_type 放进 payload，
        // 经心跳 ...realPayload 透传到 agent。不能靠 task.type（getQueuedTasks 只 select
        // publish 类型列 type，无 task_type 列），必须走 payload.task_type。
        fun shouldRouteWarmup(payloadTaskType: String?): Boolean = payloadTaskType == "warmup"

        // dm_outreach 判别符——同上一条注释踩过的同一个坑，只是这次是踩了没绕开：
        // 真机复现(2026-07-16，Path2 全链路真机验证 Seg4 时撞到)：acquisition-dispatch.ts
        // dispatchDue() INSERT publish_tasks 时只设置了 task_type 列 = 'dm_outreach'，
        // 从没设置 type 列（默认落 'image'，且 CHECK 约束 publish_tasks_type_check 根本不
        // 允许 'dm_outreach' 这个值，服务端也不可能设成这个值）。getQueuedTasks 只 SELECT
        // type 列（PublishTaskRow.type 类型是 'video'|'image'|'article'，压根没有
        // task_type 字段），queued_tasks.map 把它原样透传成 task.type 下发给设备。
        // 旧判据 `task.type == "dm_outreach"` 因此【永远为 false】——不是间歇失败，是
        // Seg4 私信任务在生产环境从一开始就没有任何一条真的路由到过
        // routeDmOutreachTask()。真正的判别符跟 warmup 一样得走 payload.task_type
        // （dispatchDue 把它塞进了 payload JSON 里，经心跳 realPayload 透传到 agent）。
        fun shouldRouteDmOutreach(payloadTaskType: String?): Boolean = payloadTaskType == "dm_outreach"

        // account_scan 判别符（sprint 07192358）：手动触发的账号扫描，同 warmup/dm_outreach
        // 走 payload.task_type 判别，不看 task 顶层 type（服务端恒为默认值 "image"）。
        fun shouldRouteAccountScan(payloadTaskType: String?): Boolean = payloadTaskType == "account_scan"

        /**
         * 判定某个 dm_outreach task_id 是否是本进程生命周期内已经处理过的重投递。
         * 真机复现(2026-07-17)：回执上报未确认前，心跳会把同一个 task_id 原样重投递多次
         * ——已见过就跳过，不再重复消耗频控名额、不再重复触发无障碍执行。
         */
        internal fun shouldSkipDuplicateDmTask(taskId: String, alreadySeenTaskIds: Set<String>): Boolean =
            taskId in alreadySeenTaskIds

        /**
         * 三个无障碍服务在 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 里的组件标识
         * （`pkg/.ClassName` 格式，真机实测格式，见 AndroidManifest.xml 对应 `<service>` 声明）。
         */
        val REQUIRED_ACCESSIBILITY_SERVICES = listOf(
            "com.zenithjoy.agent/.collect.DouyinCollectService",
            "com.zenithjoy.agent/.collect.DouyinDmOutreachService",
            "com.zenithjoy.agent/.account.DeviceAccountScanService",
        )

        /**
         * 判定哪些必需的无障碍服务不在系统已启用列表里。
         * 真机复现(2026-07-17)：force-stop 重启后 `enabledServicesRaw` 会变成 null
         * （系统级整体关闭），此时全部必需服务都算缺失。
         */
        internal fun missingAccessibilityServices(enabledServicesRaw: String?, requiredServices: List<String>): List<String> {
            val enabled = enabledServicesRaw?.split(":")?.toSet() ?: emptySet()
            return requiredServices.filterNot { it in enabled }
        }

        /**
         * dm_outreach 派单 payload → 搜索目标抖音号（Seg3 方案 B′）。
         *
         * DouyinDmOutreachService.startOutreach() 收到的字段是【当抖音号往搜索框里搜】的
         * （:151-153 `val targetDouyinId = ...`），所以这里只能取 douyin_id：
         * 服务端 acquisition-dispatch.ts 的 payload 里 profile_url 是给 Windows 通道
         * （douyin-dm-outreach.cjs `page.goto`）用的真 URL，语义完全相反。
         *
         * 取不到就是 null → 调用方跳过不派。**绝不回退成 profile_url**：拿 URL 去搜必然
         * NO_MATCH，白烧一次频控额度，还在 dm_outreach_log 里留下"派了但没送达"的假象，
         * 把"根本没读到号"这个真问题掩盖掉（#1306 宁可空，不可猜）。
         */
        internal fun extractDmTargetDouyinId(payload: Map<String, Any?>): String? =
            (payload["douyin_id"] as? String)?.trim()?.takeIf { it.isNotEmpty() }

        /**
         * DouyinCollectService.onCollectResult / collectResultReceiver 两条回调路径都把
         * CommentEntry 拆成平行数组（IPC/Intent extras 只能带原始类型数组）重建回来。
         *
         * 真机复现(2026-07-16)：这里此前只重建 commenterId/text 两个字段，douyinId 参数
         * 加入回调签名之前压根没地方接——Seg3 enrichCommentsWithDouyinId() 辛苦点头像
         * 读出的真实抖音号，一过这个回调边界就被彻底丢弃，跟服务端 /collect/report
         * 收不收 douyin_id 字段完全无关，根本没发出去过（真机验证：logcat 明明打出
         * "enriched douyinId 2/3 leads"，落库的 lead 却全是 douyin_id=NULL）。
         *
         * douyinIds 数组用空串 "" 当"没读到号"的哨兵值（不是 null——Intent 平行数组走
         * List<String> 省事），这里统一解回 null，绝不当真号使。
         */
        internal fun zipCommentEntries(
            commenterIds: List<String>,
            commentTexts: List<String>,
            douyinIds: List<String>,
        ): List<CommentEntry> = commenterIds.indices.map { i ->
            CommentEntry(
                commenterId = commenterIds[i],
                text = commentTexts.getOrElse(i) { "" },
                douyinId = douyinIds.getOrElse(i) { "" }.ifEmpty { null },
            )
        }

        // initAgent 单次守卫：onStartCommand 会被多次调用（开机广播 + MainActivity +
        // START_STICKY 重启），每次都 initAgent 会泄漏多套并行轮询 loop。
        internal fun shouldRunInitAgent(alreadyInitialized: Boolean): Boolean = !alreadyInitialized

        // register 重试守卫：与 agentInitialized（只管 WS/心跳轮询 loop 初始化）完全独立。
        // 只要还没注册成功、且没有另一次重试正在进行中，任何一次 onStartCommand 交付
        // （按钮点击或系统重启 Service）都应该重试注册——不需要杀进程重开 App。
        internal fun shouldRetryRegister(isRegistered: Boolean, retryInFlight: Boolean): Boolean =
            !isRegistered && !retryInFlight

        // 真机复现(2026-07-13 Honor xian-rog)：MEDIA_PROJECTION type 必须已持有有效
        // MediaProjection 授权令牌，未授权时声明该 type 会被系统 SecurityException 杀死整个
        // 服务。未授权 → 只用 DATA_SYNC（不阻塞 Agent 主链路，内容判定门槛这一刀持续
        // pending）；已授权 → 加上 MEDIA_PROJECTION（真正能截图）。
        internal fun foregroundServiceTypeFlags(hasMediaProjectionAuthorization: Boolean): Int =
            if (hasMediaProjectionAuthorization) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            }

        // busy 拒绝后的 dispatch 重试参数：覆盖一个最长 Stage 任务的执行时间窗
        private const val DISPATCH_RETRY_DELAY_MS = 30_000L
        private const val MAX_DISPATCH_RETRIES = 10

        // 组 POST /api/agent/burner/warmup-result 的 JSON body。纯字符串拼避开 org.json 的
        // JVM 单测 "not mocked" 陷阱；resultsJson 已是设备端 org.json 生成的合法数组串，原样嵌入。
        fun buildWarmupResultBody(
            taskId: String,
            deviceId: String,
            agentId: String,
            total: Int,
            alive: Int,
            offline: Int,
            resultsJson: String,
            errorCode: String,
        ): String {
            fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")
            val results = if (resultsJson.isBlank()) "[]" else resultsJson
            return "{\"task_id\":\"${esc(taskId)}\"," +
                "\"agent_id\":\"${esc(agentId)}\"," +
                "\"device_id\":\"${esc(deviceId)}\"," +
                "\"total\":$total,\"alive\":$alive,\"offline\":$offline," +
                "\"results\":$results," +
                "\"error_code\":\"${esc(errorCode)}\"}"
        }

        // 组 POST /api/agent/burner/account-scan-result 的 JSON body。纯字符串拼避开
        // org.json 的 JVM 单测"not mocked"陷阱（同 buildWarmupResultBody 套路）。
        fun buildAccountScanResultBody(
            requestId: String,
            agentId: String,
            ok: Boolean,
            stale: Boolean,
            accountIds: List<String>,
            errorCode: String,
            screenshotB64: String? = null,
            treeDump: String? = null,
        ): String {
            fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
            val ids = accountIds.joinToString(",") { "\"${esc(it)}\"" }
            val screenshotField = if (screenshotB64 != null) "\"${esc(screenshotB64)}\"" else "null"
            val treeDumpField = if (treeDump != null) "\"${esc(treeDump)}\"" else "null"
            return "{\"request_id\":\"${esc(requestId)}\"," +
                "\"agent_id\":\"${esc(agentId)}\"," +
                "\"ok\":$ok,\"stale\":$stale," +
                "\"account_ids\":[$ids]," +
                "\"error_code\":\"${esc(errorCode)}\"," +
                "\"screenshot_b64\":$screenshotField," +
                "\"tree_dump\":$treeDumpField}"
        }
    }
}
