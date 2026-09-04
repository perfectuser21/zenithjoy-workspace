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
    // in-flight 去重：done 只在执行完写入，首条还在队列/执行中时同 msgId 重投若只查 done
    // 会入队两次=动作重放。submit 加入、结果写进 done 时移除，与 done 同一把 lock。
    private val pending = mutableSetOf<String>()
    private val lock = Any()
    private val consumer: Job = scope.launch {
        for (req in channel) {
            val result = execute(req)
            synchronized(lock) {
                done[req.msgId] = result
                pending.remove(req.msgId)
            }
            if (!sendResult(result)) {
                logW("result dropped (connection lost) msgId=${req.msgId}; cached for re-delivery")
            }
        }
    }

    fun submit(request: CmdRequest) {
        val cached: Map<String, Any?>?
        synchronized(lock) {
            cached = done[request.msgId]
            if (cached == null && !pending.add(request.msgId)) {
                // 首条还在队列/执行中：静默丢弃，首条完成自然回执
                return
            }
        }
        if (cached != null) { sendResult(cached); return }
        if (!channel.trySend(request).isSuccess) {
            // 没能入队就不算 in-flight，移除占位，否则同 msgId 后续重投会被永远丢弃
            synchronized(lock) { pending.remove(request.msgId) }
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
