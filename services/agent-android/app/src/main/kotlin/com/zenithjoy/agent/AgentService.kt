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
import com.zenithjoy.agent.collect.CollectResult
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
    private var keywordPollLoop: AcquisitionKeywordPollLoop? = null
    private var accountScanLoopJob: kotlinx.coroutines.Job? = null

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
            reportAccountScanResult(requestId, ok, stale, accountIds, errorCode)
        }
    }

    private val collectResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!config.isConfigured) {
            android.util.Log.w(TAG, "licenseKey not set — agent cannot start")
            stopSelf()
            return START_NOT_STICKY
        }
        scope.launch { initAgent() }
        return START_STICKY
    }

    override fun onDestroy() {
        wsClient?.stop()
        heartbeatLoop?.stop()
        keywordPollLoop?.stop()
        accountScanLoopJob?.cancel()
        serviceJob.cancel()
        unregisterReceiver(collectResultReceiver)
        unregisterReceiver(dmOutreachResultReceiver)
        unregisterReceiver(accountScanResultReceiver)
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
                if (task.platform == "android_douyin") {
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

        // Sprint 07061301-device-account-scan-wiring — 定时触发设备账号扫描（30-60 分钟随机间隔，
        // 与 RandomDelay 一样禁止用固定常量），扫描服务自身会先判互斥锁再决定是否真的执行。
        accountScanLoopJob = scope.launch { runAccountScanLoop() }

        android.util.Log.i(TAG, "agent started — agentId=${config.agentId} machineId=${config.machineId}")
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
        android.util.Log.i(
            TAG,
            "account scan result ready to report to mid-tier: requestId=$requestId ok=$ok stale=$stale " +
                "accountCount=${accountIds.size} error=$errorCode agentId=${config.agentId} " +
                "(TODO: wire real agent_platform_sessions write-back endpoint)",
        )
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

    // taskId 对应 acquisition_keyword_tasks.id（由 ws0/ws1 派发 android_douyin 任务时下发）。
    // /api/agent/task-result 端点不存在——服务端唯一能接住评论数据的是已有的
    // /api/acquisition/comment-score-result（Windows Agent 已在用同一端点，字段一致）。
    private fun reportCollectResult(taskId: String, result: CollectResult) {
        if (taskId.isEmpty()) return
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

    companion object {
        private const val TAG = "AgentService"
        private const val NOTIFICATION_ID = 1001
    }
}
