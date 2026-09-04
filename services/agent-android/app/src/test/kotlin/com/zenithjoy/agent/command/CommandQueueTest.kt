package com.zenithjoy.agent.command

import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class CommandQueueTest {
    private fun req(id: String) = CmdRequest(id, CmdAction.DEVICE_INFO, emptyMap())

    @Test fun `执行结果按序回传且带 inReplyTo`() = runTest {
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, execute = { r -> mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a")); q.submit(req("b"))
        advanceUntilIdle()
        assertEquals(listOf("a", "b"), sent.map { it["inReplyTo"] })
        q.close()
    }

    @Test fun `同 msgId 重复提交返回缓存结果不重执行`() = runTest {
        var execCount = 0
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, execute = { r -> execCount++; mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a"))
        advanceUntilIdle()
        q.submit(req("a")) // 重投递
        advanceUntilIdle()
        assertEquals(1, execCount)
        assertEquals(2, sent.size) // 两次都回了结果
        q.close()
    }

    @Test fun `队列满回 QUEUE_FULL`() = runTest {
        // StandardTestDispatcher 下消费协程在 advanceUntilIdle 前不运行：
        // a、b 占满 capacity=2 缓冲，c 溢出 → 确定性 QUEUE_FULL
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, capacity = 2, execute = { r -> mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a")); q.submit(req("b")); q.submit(req("c"))
        val full = sent.first { it["inReplyTo"] == "c" }
        assertEquals(CommandProtocol.ERR_QUEUE_FULL, full["errorCode"])
        advanceUntilIdle()
        q.close()
    }
}
