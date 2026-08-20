package com.zenithjoy.agent

import com.google.gson.Gson
import com.zenithjoy.agent.onboarding.ReadinessItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP 心跳循环（ws1 协议，对齐桌面 agent HeartbeatLoop）。
 *
 * 每 intervalMs（默认 20s）POST /api/agent/heartbeat，为取消命令的 30s
 * 送达合同预留网络往返与系统调度抖动余量。
 * 响应里的 agent_id 持久化到 params.onAgentIdReceived（首次心跳收敛身份）。
 * queued_tasks 转发给 onTask 回调，由 AgentService 路由处理。
 */
class HttpHeartbeatLoop(
    private val params: Params,
    private val scope: CoroutineScope,
    private val intervalMs: Long = 20_000L,
    private val onTask: ((task: HeartbeatTask) -> Unit)? = null,
    private val onHeartbeat: ((resp: HeartbeatResponse) -> Unit)? = null,
    private val onAgentIdReceived: ((agentId: String) -> Unit)? = null,
    private val httpClient: OkHttpClient = defaultClient(),
    /**
     * 设备就绪度求值器。**每次心跳前重新调用**，不是启动时的快照——
     * 就绪是会掉的状态（force-stop 关无障碍 0717 / adb install -r 静默撤销 0803），
     * 快照会一直报绿，等于又造一个假绿。心跳本来 20 秒一次，复检借它的车不另起循环。
     * null = 不上报这个字段（向后兼容，不影响老链路）。
     */
    private val readinessProvider: (() -> Map<String, ReadinessItem>)? = null,
) {
    private val gson = Gson()
    private var job: Job? = null

    /** 心跳请求所需的最小参数集（纯 data class，无 Android 框架依赖，方便单测）。 */
    data class Params(
        val httpBase: String,           // https://autopilot.zenjoymedia.media
        val licenseKey: String,
        val agentId: String,            // 当前运行期 agentId
        val agentUuid: String,          // register 返的 UUID（可空）
        val machineId: String,
        val hostname: String,
        val osType: String = "android",
        val version: String = BuildConfig.VERSION_NAME,
    )

    data class HeartbeatTask(
        val task_id: String,
        val platform: String,
        val payload: Map<String, Any?> = emptyMap(),
        // Sprint 07052218 followup — 服务端 queued_tasks.map 同时下发 platform 和 type
        // （walking-skeleton.ts: `type: t.type`，对 dm_outreach 任务 platform='douyin'/
        // type='dm_outreach'）。此前完全没有解析，AgentService 无法区分 android_douyin
        // 采集任务和 dm_outreach 私信触达任务。
        val type: String = "",
    )

    data class HeartbeatResponse(
        val ok: Boolean = false,
        val agent_id: String = "",
        val queued_tasks: List<Map<String, Any?>>? = null,
    )

    fun start() {
        job = scope.launch { loop() }
    }

    fun stop() {
        job?.cancel()
    }

    private suspend fun loop() {
        while (scope.isActive) {
            sendOnce()
            delay(intervalMs)
        }
    }

    internal fun sendOnce() {
        val url = "${params.httpBase.trimEnd('/')}/api/agent/heartbeat"

        val body = buildMap<String, Any?> {
            put("license", params.licenseKey)
            put("version", params.version)
            put("hostname", params.hostname)
            put("os_type", params.osType)
            val agentIdToSend = params.agentId.ifEmpty { params.agentUuid.ifEmpty { null } }
            if (agentIdToSend != null) put("agent_id", agentIdToSend)
            if (params.agentUuid.isNotEmpty()) put("agent_uuid", params.agentUuid)
            if (params.machineId.isNotEmpty()) put("machine_id", params.machineId)
            // 求值失败绝不阻断心跳——心跳是客户机上唯一的远程视野，丢了它就彻底看不见这台设备
            val readiness = try {
                readinessProvider?.invoke()
            } catch (e: Exception) {
                // 日志本身也要吞：纯 JVM 单测下 android.util.Log 未 mock 会抛 RuntimeException
                // （同 AcquisitionCollectPollLoop 的既有约定）。更要紧的是——这行就在 catch 块里，
                // 它自己抛出来照样会把心跳带崩，而心跳是客户机上唯一的远程视野。
                try {
                    android.util.Log.w(TAG, "readiness 求值失败，本次心跳不带该字段: ${e.message}")
                } catch (_: RuntimeException) {
                }
                null
            }
            if (readiness != null && readiness.isNotEmpty()) put("readiness", readiness)
        }

        val request = Request.Builder()
            .url(url)
            .post(gson.toJson(body).toRequestBody("application/json".toMediaType()))
            .build()

        try {
            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                android.util.Log.w(TAG, "heartbeat http ${response.code}")
                return
            }
            val raw = response.body?.string() ?: return
            val resp = gson.fromJson(raw, HeartbeatResponse::class.java)
            if (!resp.ok || resp.agent_id.isEmpty()) {
                android.util.Log.w(TAG, "heartbeat response missing ok/agent_id")
                return
            }

            onAgentIdReceived?.invoke(resp.agent_id)
            onHeartbeat?.invoke(resp)

            resp.queued_tasks?.forEach { rawTask ->
                try {
                    val taskId = rawTask["task_id"] as? String ?: return@forEach
                    val platform = rawTask["platform"] as? String ?: return@forEach
                    val type = rawTask["type"] as? String ?: ""
                    @Suppress("UNCHECKED_CAST")
                    val payload = (rawTask["payload"] as? Map<String, Any?>) ?: emptyMap()
                    onTask?.invoke(HeartbeatTask(taskId, platform, payload, type))
                } catch (e: Exception) {
                    android.util.Log.w(TAG, "task parse error: ${e.message}")
                }
            }
        } catch (e: IOException) {
            android.util.Log.w(TAG, "heartbeat error: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "HttpHeartbeatLoop"

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}

/** AgentConfig → HttpHeartbeatLoop.Params 的便捷扩展函数。 */
fun AgentConfig.toHeartbeatParams(hostname: String): HttpHeartbeatLoop.Params =
    HttpHeartbeatLoop.Params(
        httpBase = deriveHttpBase(),
        licenseKey = licenseKey,
        agentId = agentId,
        agentUuid = agentUuid,
        machineId = machineId,
        hostname = hostname,
    )
