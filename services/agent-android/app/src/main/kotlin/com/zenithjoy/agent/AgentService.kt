package com.zenithjoy.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.IBinder
import com.google.gson.Gson
import com.zenithjoy.agent.account.DeviceAccountModel
import com.zenithjoy.agent.account.DeviceAccountRegistry
import com.zenithjoy.agent.account.DeviceAccountScanService
import com.zenithjoy.agent.collect.CollectJob
import com.zenithjoy.agent.collect.CollectReporter
import com.zenithjoy.agent.collect.CollectResult
import com.zenithjoy.agent.collect.CollectTaskQueue
import com.zenithjoy.agent.collect.CommentEntry
import com.zenithjoy.agent.collect.DmOutreachRateLimiter
import com.zenithjoy.agent.collect.DouyinCollectService
import com.zenithjoy.agent.collect.DouyinDmOutreachService
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
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private lateinit var config: AgentConfig
    private var wsClient: WsClient? = null
    private var heartbeatLoop: HttpHeartbeatLoop? = null
    // initAgent 只允许执行一次（真机复现 2026-07-10：多次 onStartCommand 泄漏多套轮询 loop）
    @Volatile private var agentInitialized = false
    private var keywordPollLoop: AcquisitionKeywordPollLoop? = null
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
            // 网络请求不能跑主线程(NetworkOnMainThreadException)，跟 warmupResultReceiver 同套路。
            scope.launch(Dispatchers.IO) { reportAccountScanResult(requestId, ok, stale, accountIds, errorCode) }
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
            val comments = commenterIds.indices.map { i ->
                CommentEntry(commenterId = commenterIds[i], text = commentTexts.getOrElse(i) { "" })
            }
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
            agentId = config.agentId,
        )
        startForeground(NOTIFICATION_ID, buildNotification())
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
        DouyinCollectService.onCollectResult = { taskId, ok, commentIds, commentTexts, error ->
            val comments = commentIds.indices.map { i ->
                CommentEntry(commenterId = commentIds[i], text = commentTexts.getOrElse(i) { "" })
            }
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
        // 真机复现(2026-07-10)：lastStartId=3 → initAgent 跑了 3 次，泄漏 3 套轮询
        // loop（旧 loop 只在 onDestroy 停），同一任务每周期被投递 N 次。只初始化一次。
        if (shouldRunInitAgent(agentInitialized)) {
            agentInitialized = true
            scope.launch { initAgent() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        wsClient?.stop()
        heartbeatLoop?.stop()
        keywordPollLoop?.stop()
        collectPollLoop?.stop()
        accountScanLoopJob?.cancel()
        serviceJob.cancel()
        unregisterReceiver(collectResultReceiver)
        unregisterReceiver(dmOutreachResultReceiver)
        unregisterReceiver(accountScanResultReceiver)
        unregisterReceiver(warmupResultReceiver)
        DouyinCollectService.onCollectResult = null
        DouyinCollectService.onVideoCardResult = null
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
        if (!config.isRegistered) {
            android.util.Log.i(TAG, "registering with license...")
            val registrar = AgentRegistrar()
            val result = withContext(Dispatchers.IO) { registrar.register(config) }
            if (result != null) {
                config.wsToken = result.wsToken
                config.machineId = result.machineId
                if (!result.tier.isNullOrEmpty()) config.tier = result.tier
                if (!result.agentUuid.isNullOrEmpty()) config.agentUuid = result.agentUuid
                android.util.Log.i(TAG, "registered — tier=${config.tier} uuid=${config.agentUuid}")
            } else {
                android.util.Log.w(TAG, "registration failed — continuing with license key fallback")
            }
        } else {
            android.util.Log.i(TAG, "already registered, skipping")
        }

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
                } else if (task.type == "dm_outreach") {
                    routeDmOutreachTask(task)
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

        // 关键词采集任务轮询（真实任务源 — 见 AcquisitionKeywordPollLoop 头部注释）
        keywordPollLoop = AcquisitionKeywordPollLoop(
            params = AcquisitionKeywordPollLoop.Params(
                httpBase = config.deriveHttpBase(),
                licenseKey = config.licenseKey,
            ),
            scope = scope,
            onTask = { task ->
                android.util.Log.i(TAG, "keyword task: id=${task.task_id} keyword=${task.keyword}")
                DouyinCollectService.dispatchTask(this@AgentService, task.keyword, task.task_id)
            },
        )
        keywordPollLoop?.start()

        // reporter 使用最新 agentId（initAgent 之后才确定）
        reporter = CollectReporter(
            httpBase = config.deriveHttpBase(),
            agentId = config.agentId,
        )

        // 两阶段采集任务轮询（Path 2 Step 5）
        // 与 keywordPollLoop 并行双跑，通过 collectTaskIds Set 在 onCollectResult 中区分路由
        collectPollLoop = AcquisitionCollectPollLoop(
            agentId = config.agentId,
            httpBase = config.deriveHttpBase(),
            scope = scope,
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
        val profileUrl = task.payload["profile_url"] as? String ?: ""
        val message = task.payload["message"] as? String ?: ""
        val accountLabel = task.payload["account_label"] as? String ?: ""
        val dmAssignmentId = task.payload["dm_assignment_id"] as? String ?: ""
        if (profileUrl.isBlank() || message.isBlank()) {
            android.util.Log.w(TAG, "dm_outreach task ${task.task_id} missing profile_url/message — skip")
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
            reportDmOutreachResult(task.task_id, "failed", dmAssignmentId, accountLabel, profileUrl, "ACCOUNT_OFFLINE_AT_DISPATCH")
            return
        }

        val now = System.currentTimeMillis()
        val withinLimit = DmOutreachRateLimiter.isWithinLimit(dmSentTimestamps.toList(), now)
        if (!withinLimit) {
            android.util.Log.w(TAG, "dm_outreach task ${task.task_id} rate-limited — reporting limited without dispatch")
            DouyinDmOutreachService.dispatchRateLimited(
                this, task.task_id, dmAssignmentId, accountLabel, profileUrl,
            )
            return
        }
        dmSentTimestamps.add(now)
        DouyinDmOutreachService.dispatchTask(
            this, profileUrl, message, task.task_id, dmAssignmentId, accountLabel,
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
    ) {
        val url = "${config.deriveHttpBase()}/api/agent/burner/account-scan-result"
        val body = buildAccountScanResultBody(requestId, config.agentId, ok, stale, accountIds, errorCode)
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
                            reporter?.reportVideos(taskId, videos, errorCode = if (videos.isEmpty()) errorCode else null)
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
                val commenters = result.comments.map { c ->
                    buildMap<String, Any?> {
                        put("nickname", c.commenterId)
                        put("comment_text", c.text)
                    }
                }
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
        val commenters = result.comments.map { c ->
            buildMap<String, Any?> {
                put("nickname", c.commenterId)
                put("comment_text", c.text)
            }
        }
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

        // Line02 warmup 判别符：中台 INSERT publish_tasks 时把 task_type 放进 payload，
        // 经心跳 ...realPayload 透传到 agent。不能靠 task.type（getQueuedTasks 只 select
        // publish 类型列 type，无 task_type 列），必须走 payload.task_type。
        fun shouldRouteWarmup(payloadTaskType: String?): Boolean = payloadTaskType == "warmup"

        // initAgent 单次守卫：onStartCommand 会被多次调用（开机广播 + MainActivity +
        // START_STICKY 重启），每次都 initAgent 会泄漏多套并行轮询 loop。
        internal fun shouldRunInitAgent(alreadyInitialized: Boolean): Boolean = !alreadyInitialized

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
        ): String {
            fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")
            val ids = accountIds.joinToString(",") { "\"${esc(it)}\"" }
            return "{\"request_id\":\"${esc(requestId)}\"," +
                "\"agent_id\":\"${esc(agentId)}\"," +
                "\"ok\":$ok,\"stale\":$stale," +
                "\"account_ids\":[$ids]," +
                "\"error_code\":\"${esc(errorCode)}\"}"
        }
    }
}
