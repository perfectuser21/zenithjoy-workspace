package com.zenithjoy.agent

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AcquisitionKeywordPollLoopTest {

    private val server = MockWebServer()

    @Before
    fun setUp() { server.start() }

    @After
    fun tearDown() { server.shutdown() }

    private fun makeParams(base: String, licenseKey: String = "ZJ-TEST") =
        AcquisitionKeywordPollLoop.Params(httpBase = base, licenseKey = licenseKey)

    @Test
    fun `poll GET carries x-agent-license header`() = runTest {
        server.enqueue(MockResponse().setBody("""{"tasks":[],"total":0}"""))

        val loop = AcquisitionKeywordPollLoop(
            params = makeParams(server.url("/").toString().trimEnd('/'), licenseKey = "ZJ-ABC-123"),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("ZJ-ABC-123", req.getHeader("x-agent-license"))
        assertTrue("path should hit pending-keyword-tasks", req.path?.contains("pending-keyword-tasks") == true)
    }

    @Test
    fun `tasks in response dispatched to onTask with real task_id`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"tasks":[
              {"task_id":"kw-task-uuid-1","keyword":"麻婆豆腐","keywords":["麻婆豆腐","川菜"]}
            ],"total":1}
        """.trimIndent()))

        var received: AcquisitionKeywordPollLoop.KeywordTask? = null
        val loop = AcquisitionKeywordPollLoop(
            params = makeParams(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            onTask = { received = it },
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals("kw-task-uuid-1", received?.task_id)
        assertEquals("麻婆豆腐", received?.keyword)
        assertEquals(listOf("麻婆豆腐", "川菜"), received?.keywords)
    }

    @Test
    fun `empty tasks list does not invoke onTask`() = runTest {
        server.enqueue(MockResponse().setBody("""{"tasks":[],"total":0}"""))

        var received: AcquisitionKeywordPollLoop.KeywordTask? = null
        val loop = AcquisitionKeywordPollLoop(
            params = makeParams(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            onTask = { received = it },
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertNull(received)
    }

    @Test
    fun `empty license key skips request entirely`() = runTest {
        val loop = AcquisitionKeywordPollLoop(
            params = makeParams(server.url("/").toString().trimEnd('/'), licenseKey = ""),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals(0, server.requestCount)
    }
}
