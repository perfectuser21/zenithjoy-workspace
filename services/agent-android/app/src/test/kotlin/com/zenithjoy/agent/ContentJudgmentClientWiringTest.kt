package com.zenithjoy.agent
import org.junit.Test
import org.junit.Assert.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
class ContentJudgmentClientWiringTest {
    @Test fun `AgentService production assembly invokes judgment and filters rejected stage2 URLs`() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setBody("""{"tasks":[{"task_id":"t1","stage":"stage_2","video_urls":["https://www.douyin.com/note/11111111111","https://www.douyin.com/note/22222222222"]}]}"""))
            server.enqueue(MockResponse().setBody("""{"judgment_status":"rejected"}"""))
            server.enqueue(MockResponse().setBody("""{"judgment_status":"matched"}"""))
            val dispatched = mutableListOf<String>()
            val loop = AgentService.createJudgedCollectPollLoop(agentId = { "service-agent" }, httpBase = server.url("/").toString(), scope = CoroutineScope(Dispatchers.Unconfined), screenCaptureService = ScreenCaptureService(captureImpl = { "actualCaptureBoundary" }), onStage2Task = { _, urls, _ -> dispatched.addAll(urls) })
            loop.pollOnce()
            assertEquals(listOf("https://www.douyin.com/note/22222222222"), dispatched)
            assertEquals("/api/acquisition/pending-collect-tasks", server.takeRequest().path)
            val judged = server.takeRequest()
            assertEquals("service-agent", judged.getHeader("x-agent-id")); assertEquals("/api/acquisition/judge-video", judged.path)
            assertTrue(judged.body.readUtf8().contains("actualCaptureBoundary")); assertEquals("/api/acquisition/judge-video", server.takeRequest().path)
        }
    }
    @Test fun `ScreenCaptureService returns injected capture bytes`() { assertEquals("captured", ScreenCaptureService(captureImpl = { "captured" }).captureToBase64()) }
    @Test fun `ScreenCaptureService returns null on capture failure`() { assertNull(ScreenCaptureService(captureImpl = { null }).captureToBase64()) }
    @Test fun `failed capture is actually reported to server as skipped_capture_failed`() {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse().setBody("""{"judgment_status":"pending","judgment_reason":"skipped_capture_failed"}"""))
            val service = ContentJudgmentService(agentId = { "agent" }, httpBase = server.url("/").toString(), tenantId = { "tenant" }, screenCaptureService = ScreenCaptureService(captureImpl = { null }))
            val result = service.judge("video", "screenshot", "")
            val request = server.takeRequest(); assertTrue(request.body.readUtf8().contains("\"capture_type\":\"skipped_capture_failed\""))
            assertEquals("pending", result.judgmentStatus); assertEquals("skipped_capture_failed", result.judgmentReason)
        }
    }
    @Test fun `non-empty data traverses real judge request without taking another capture`() {
        var captureCalled = false; var body = ""
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request(); val buffer = Buffer(); request.body!!.writeTo(buffer); body = buffer.readUtf8()
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType())).build()
        }.build()
        val service = ContentJudgmentService(agentId = { "agent" }, httpBase = "http://localhost:9", tenantId = { "valid-tenant" }, httpClient = client, screenCaptureService = ScreenCaptureService(captureImpl = { captureCalled = true; "wrongCapture" }))
        assertEquals("matched", service.judge("video", "screenshot", "existingData").judgmentStatus)
        assertFalse(captureCalled); assertTrue(body.contains("existingData")); assertFalse(body.contains("wrongCapture"))
    }
    @Test fun `real timeout adapter returns pending without sleeping or external network`() {
        val client = OkHttpClient.Builder().addInterceptor { throw java.net.SocketTimeoutException("isolated timeout") }.build()
        val service = ContentJudgmentService(agentId = { "agent" }, httpBase = "http://localhost:9", tenantId = { "tenant" }, httpClient = client)
        val result = service.judge("video", "screenshot", "data")
        assertEquals("pending", result.judgmentStatus); assertEquals("timeout_or_network_error", result.judgmentReason)
    }
    @Test fun `all rejected results from service assembly never invoke Stage2 callback`() {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse().setBody("""{"tasks":[{"task_id":"reject","stage":"stage_2","video_urls":["https://www.douyin.com/note/11111111111"]}]}""")); server.enqueue(MockResponse().setBody("""{"judgment_status":"rejected"}"""))
            var dispatched = false
            AgentService.createJudgedCollectPollLoop(agentId = { "agent" }, httpBase = server.url("/").toString(), scope = CoroutineScope(Dispatchers.Unconfined), screenCaptureService = ScreenCaptureService(captureImpl = { "data" }), onStage2Task = { _, _, _ -> dispatched = true }).pollOnce()
            assertFalse(dispatched); assertEquals(2, server.requestCount)
        }
    }
}
