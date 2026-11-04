package com.zenithjoy.agent
import com.zenithjoy.agent.command.*
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceUntilIdle
import org.junit.Assert.*
import org.junit.Test
class AgentServiceCommandRouteTest {
    @Test fun `live service router submits valid command through actual queue and returns its result`() = runTest {
        val executed = mutableListOf<CmdRequest>()
        val replies = mutableListOf<Map<String, Any?>>()
        val queue = CommandQueue(this, execute = { executed.add(it); CommandProtocol.buildResult(it.msgId, CmdOutcome(true), null) }, sendResult = { replies.add(it); true })
        AgentService.routeDeviceCommand(mapOf("action" to "tap", "x" to 20, "y" to 30), "request-1", 100, 100, queue::submit, { replies.add(it); true })
        advanceUntilIdle()
        assertEquals(1, executed.size); assertEquals(CmdAction.TAP, executed[0].action)
        assertEquals("request-1", replies.single()["inReplyTo"])
        queue.close()
    }
    @Test fun `live service router rejects malformed and out of bounds commands without submitting`() {
        val submitted = mutableListOf<CmdRequest>(); val replies = mutableListOf<Map<String, Any?>>()
        for (payload in listOf(mapOf("action" to "unknown"), mapOf("action" to "tap", "x" to 101, "y" to 20))) {
            AgentService.routeDeviceCommand(payload, "bad", 100, 100, { submitted.add(it) }, { replies.add(it); true })
        }
        assertTrue(submitted.isEmpty()); assertEquals(2, replies.size)
        assertEquals(listOf("UNKNOWN_ACTION", "COORD_OUT_OF_BOUNDS"), replies.map { it["errorCode"] })
    }
    @Test fun `missing correlation id never executes or emits an uncorrelated reply`() {
        var called = false
        AgentService.routeDeviceCommand(mapOf("action" to "device_info"), null, 100, 100, { called = true }, { called = true; true })
        assertFalse(called)
    }
}
