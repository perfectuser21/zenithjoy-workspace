package com.zenithjoy.agent

import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * WS 客户端（ws0 协议，对齐桌面 agent connect() 函数）。
 *
 * 协议：
 *   - 连接后立刻发 hello 消息
 *   - 每 15s 发 heartbeat（{uptime, busy: false}）
 *   - 断线指数退避重连（1s → 30s 上限）
 *
 * 消息信封（对齐 apps/api/src/schemas/agent-protocol.ts）：
 *   { v:1, type, msgId, ts, payload }
 */
class WsClient(
    private val config: AgentConfig,
    private val scope: CoroutineScope,
    private val onMessage: ((type: String, payload: Map<*, *>) -> Unit)? = null,
) {
    private val gson = Gson()
    private val startTime = System.currentTimeMillis()
    private var backoffMs = 1_000L
    private val MAX_BACKOFF_MS = 30_000L
    private val HEARTBEAT_INTERVAL_MS = 15_000L

    private val wsRef = AtomicReference<WebSocket?>()
    private val heartbeatJob = AtomicReference<Job?>()
    private var connectJob: Job? = null

    fun start() {
        connectJob = scope.launch { connect() }
    }

    fun stop() {
        connectJob?.cancel()
        heartbeatJob.get()?.cancel()
        wsRef.get()?.close(1000, "agent stopped")
    }

    private suspend fun connect() {
        while (scope.isActive) {
            val wsUrl = buildWsUrl()
            android.util.Log.i(TAG, "connecting to $wsUrl")

            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build()

            val request = Request.Builder().url(wsUrl).build()
            var connected = false

            val latch = java.util.concurrent.CountDownLatch(1)

            client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    wsRef.set(ws)
                    backoffMs = 1_000L
                    connected = true
                    android.util.Log.i(TAG, "connected as ${config.agentId}")
                    ws.send(gson.toJson(makeMsg("hello", buildHelloPayload())))
                    heartbeatJob.set(scope.launch { runHeartbeat(ws) })
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    handleMessage(text)
                }

                override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                    ws.close(1000, null)
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    android.util.Log.i(TAG, "closed: $code $reason")
                    wsRef.set(null)
                    heartbeatJob.getAndSet(null)?.cancel()
                    latch.countDown()
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    android.util.Log.w(TAG, "error: ${t.message}")
                    wsRef.set(null)
                    heartbeatJob.getAndSet(null)?.cancel()
                    latch.countDown()
                }
            })

            // Wait for disconnect
            latch.await()
            client.dispatcher.executorService.shutdown()

            if (!scope.isActive) break
            android.util.Log.i(TAG, "reconnecting in ${backoffMs}ms")
            delay(backoffMs)
            backoffMs = minOf(backoffMs * 2, MAX_BACKOFF_MS)
        }
    }

    private suspend fun runHeartbeat(ws: WebSocket) {
        val job = heartbeatJob.get() ?: return
        while (job.isActive && ws.send("")) { // ping to check open
            ws.send(gson.toJson(makeMsg("heartbeat", mapOf(
                "uptime" to (System.currentTimeMillis() - startTime),
                "busy" to false,
            ))))
            delay(HEARTBEAT_INTERVAL_MS)
        }
    }

    private fun handleMessage(text: String) {
        try {
            @Suppress("UNCHECKED_CAST")
            val msg = gson.fromJson(text, Map::class.java) as Map<String, Any>
            val type = msg["type"] as? String ?: return
            @Suppress("UNCHECKED_CAST")
            val payload = msg["payload"] as? Map<*, *> ?: emptyMap<String, Any>()
            android.util.Log.d(TAG, "received: $type")
            onMessage?.invoke(type, payload)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "invalid message: ${e.message}")
        }
    }

    private fun buildWsUrl(): String {
        val token = config.wsToken.ifEmpty { config.licenseKey }
        return "${config.apiUrl}?token=${java.net.URLEncoder.encode(token, "UTF-8")}"
    }

    private fun buildHelloPayload(): Map<String, Any?> {
        val p = mutableMapOf<String, Any?>(
            "agentId" to config.agentId,
            "version" to BuildConfig.VERSION_NAME,
            "capabilities" to listOf("android"),
        )
        if (config.agentUuid.isNotEmpty()) p["agentUuid"] = config.agentUuid
        return p
    }

    private fun makeMsg(type: String, payload: Any): Map<String, Any?> = mapOf(
        "v" to 1,
        "type" to type,
        "msgId" to UUID.randomUUID().toString(),
        "ts" to System.currentTimeMillis(),
        "payload" to payload,
    )

    companion object {
        private const val TAG = "WsClient"
    }
}
