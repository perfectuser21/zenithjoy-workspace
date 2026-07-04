package com.zenithjoy.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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

    private lateinit var config: AgentConfig
    private var wsClient: WsClient? = null
    private var heartbeatLoop: HttpHeartbeatLoop? = null

    override fun onCreate() {
        super.onCreate()
        config = AgentConfig(this)
        startForeground(NOTIFICATION_ID, buildNotification())
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
        serviceJob.cancel()
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
                // 无障碍服务采集逻辑留给下一个 task，此处只记录
            },
        )
        wsClient?.start()

        // HTTP 心跳循环（ws1 协议，30s interval）
        heartbeatLoop = HttpHeartbeatLoop(
            params = config.toHeartbeatParams(android.os.Build.MODEL),
            scope = scope,
            onTask = { task ->
                android.util.Log.i(TAG, "ws1 task: ${task.platform} id=${task.task_id}")
                // 无障碍服务采集逻辑留给下一个 task，此处只记录
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

    companion object {
        private const val TAG = "AgentService"
        private const val NOTIFICATION_ID = 1001
    }
}
