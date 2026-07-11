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
        version = "test-version",
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
    fun `queued_tasks type field is passed through for dm_outreach routing`() = runTest {
        // Sprint 07052218 followup — AgentService 需要按 task.type=="dm_outreach" 区分
        // 私信触达任务和 android_douyin 采集任务，此前 HeartbeatTask 完全丢弃了服务端
        // 已下发的 `type` 字段（walking-skeleton.ts queued_tasks.map 里 type: t.type），
        // 导致 dm_outreach 任务下发后 Android 端无法识别、永远不会被路由。
        server.enqueue(MockResponse().setBody("""
            {"ok":true,"agent_id":"uuid-1","queued_tasks":[
              {"task_id":"t2","platform":"douyin","type":"dm_outreach",
               "payload":{"profile_url":"https://www.douyin.com/user/abc","message":"你好"}}
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
        assertEquals("douyin", receivedTask?.platform)
        assertEquals("dm_outreach", receivedTask?.type)
        assertEquals("https://www.douyin.com/user/abc", receivedTask?.payload?.get("profile_url"))
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
