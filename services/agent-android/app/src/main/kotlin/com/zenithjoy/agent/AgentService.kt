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
import com.zenithjoy.agent.collect.CollectResult
import com.zenithjoy.agent.collect.CommentEntry
import com.zenithjoy.agent.collect.DouyinCollectService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

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
        serviceJob.cancel()
        unregisterReceiver(collectResultReceiver)
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
                android.util.Log.i(TAG, "ws1 task: ${task.platform} id=${task.task_id}")
                if (task.platform == "android_douyin") {
                    val keyword = task.payload["keyword"] as? String ?: ""
                    if (keyword.isNotBlank()) {
                        DouyinCollectService.dispatchTask(this@AgentService, keyword, task.task_id)
                    }
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

        android.util.Log.i(TAG, "agent started — agentId=${config.agentId} machineId=${config.machineId}")
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
