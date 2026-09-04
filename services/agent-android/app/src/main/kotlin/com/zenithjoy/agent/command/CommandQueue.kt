package com.zenithjoy.agent.command

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * 有界指令队列：入队立即返回（okhttp reader 线程绝不阻塞），单消费协程串行执行。
 * correlation-id LRU 去重：同 msgId 重复到达返回缓存首次结果，不重放动作
 * （heartbeat 重投递前科见 AgentService dmSeenTaskIds 注释）；重连后中台按
 * msgId 重发也走这条路，天然实现「断线结果重取」。
 */
class CommandQueue(
    scope: CoroutineScope,
    private val execute: suspend (CmdRequest) -> Map<String, Any?>,
    private val sendResult: (Map<String, Any?>) -> Boolean,
    capacity: Int = 8,
    private val dedupCapacity: Int = 32,
) {
    private val channel = Channel<CmdRequest>(capacity)
    private val done = object : LinkedHashMap<String, Map<String, Any?>>(dedupCapacity, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Map<String, Any?>>) = size > dedupCapacity
    }
    private val lock = Any()
    private val consumer: Job = scope.launch {
        for (req in channel) {
            val result = execute(req)
            synchronized(lock) { done[req.msgId] = result }
            if (!sendResult(result)) {
                logW("result dropped (connection lost) msgId=${req.msgId}; cached for re-delivery")
            }
        }
    }

    fun submit(request: CmdRequest) {
        val cached = synchronized(lock) { done[request.msgId] }
        if (cached != null) { sendResult(cached); return }
        if (!channel.trySend(request).isSuccess) {
            sendResult(
                CommandProtocol.buildResult(
                    request.msgId,
                    CmdOutcome(false, CommandProtocol.ERR_QUEUE_FULL),
                    null,
                ),
            )
        }
    }

    fun close() {
        channel.close()
        consumer.cancel()
    }

    private fun logW(message: String) {
        try { android.util.Log.w("CommandQueue", message) } catch (_: RuntimeException) { /* JVM 单测 */ }
    }
}
