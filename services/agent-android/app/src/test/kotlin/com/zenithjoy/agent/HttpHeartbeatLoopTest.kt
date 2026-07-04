package com.zenithjoy.agent

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HttpHeartbeatLoopTest {

    private val server = MockWebServer()

    @Before
    fun setUp() { server.start() }

    @After
    fun tearDown() { server.shutdown() }

    private fun makeParams(base: String) = HttpHeartbeatLoop.Params(
        httpBase = base,
        licenseKey = "ZJ-TEST",
        agentId = "agent-test",
        agentUuid = "",
        machineId = "machine-abc",
        hostname = "test-device",
        osType = "android",
        version = AgentConfig.AGENT_VERSION,
    )

    @Test
    fun `heartbeat POST body contains required fields`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))

        val loop = HttpHeartbeatLoop(
            params = makeParams(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        val req = server.takeRequest()
        val body = req.body.readUtf8()
        assertEquals("POST", req.method)
        assert(body.contains("\"license\"")) { "body should contain license: $body" }
        assert(body.contains("\"version\"")) { "body should contain version: $body" }
        assert(body.contains("\"os_type\"")) { "body should contain os_type: $body" }
        assert(body.contains("\"machine_id\"")) { "body should contain machine_id: $body" }
    }

    @Test
    fun `heartbeat response queued_tasks dispatched to onTask`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"ok":true,"agent_id":"uuid-1","queued_tasks":[
              {"task_id":"t1","platform":"android","payload":{}}
            ]}
        """.trimIndent()))

        var receivedTask: HttpHeartbeatLoop.HeartbeatTask? = null
        val loop = HttpHeartbeatLoop(
            params = makeParams(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            onTask = { receivedTask = it },
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertNotNull(receivedTask)
        assertEquals("t1", receivedTask?.task_id)
        assertEquals("android", receivedTask?.platform)
    }

    @Test
    fun `agent_id from response triggers onAgentIdReceived`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"server-assigned-uuid"}"""))

        var receivedId: String? = null
        val loop = HttpHeartbeatLoop(
            params = makeParams(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            onAgentIdReceived = { receivedId = it },
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals("server-assigned-uuid", receivedId)
    }
}
