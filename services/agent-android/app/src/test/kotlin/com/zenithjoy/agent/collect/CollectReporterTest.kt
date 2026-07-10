package com.zenithjoy.agent.collect

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CollectReporterTest {

    private val server = MockWebServer()

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun makeReporter(sleepFn: (Long) -> Unit = {}): CollectReporter {
        return CollectReporter(
            httpBase = server.url("/").toString().trimEnd('/'),
            agentId = "AGENT-TEST-001",
            httpClient = OkHttpClient(),
            sleepFn = sleepFn,
        )
    }

    // TC-R01: reportVideos 发出 POST /collect/report-videos，payload 含 task_id/videos，header 含 x-agent-id
    @Test
    fun `reportVideos_sends_POST_to_report_videos_with_correct_payload_and_header`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val videos = listOf(
            CollectReporter.VideoInfo(video_id = "video123", keyword = "keyword1"),
        )
        val result = reporter.reportVideos("task-001", videos)

        assertTrue(result.success)
        assertNull(result.code)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertTrue("path should contain report-videos", req.path?.contains("report-videos") == true)
        assertEquals("AGENT-TEST-001", req.getHeader("x-agent-id"))

        val body = req.body.readUtf8()
        assertTrue("body should contain task_id", body.contains("task-001"))
        assertTrue("body should contain videos", body.contains("video123"))
        assertTrue("body should contain keyword", body.contains("keyword1"))
    }

    // TC-R02: reportVideos 收到 409 时不重试（直接返回 false）
    @Test
    fun `reportVideos_409_does_not_retry_returns_false`() {
        server.enqueue(MockResponse().setResponseCode(409).setBody("conflict"))
        // 如果有重试，会读第二个 response；没有就只读了 1 个
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val result = reporter.reportVideos("task-409", emptyList())

        assertFalse(result.success)
        assertEquals("HTTP_409", result.code)
        // 只发了 1 次请求（没有重试）
        assertEquals(1, server.requestCount)
    }

    // TC-R03: reportVideos 收到 403 时不重试（直接返回 false）
    @Test
    fun `reportVideos_403_does_not_retry_returns_false`() {
        server.enqueue(MockResponse().setResponseCode(403).setBody("forbidden"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val result = reporter.reportVideos("task-403", emptyList())

        assertFalse(result.success)
        assertEquals("HTTP_403", result.code)
        assertEquals(1, server.requestCount)
    }

    // TC-R04: reportVideos 网络错误时重试 1 次（使用注入 sleepFn 跳过 sleep）
    @Test
    fun `reportVideos_network_error_retries_once`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        var sleepCalled = 0
        val reporter = makeReporter(sleepFn = { sleepCalled++ })
        val result = reporter.reportVideos("task-retry", emptyList())

        // 重试一次后成功
        assertTrue(result.success)
        assertEquals(1, sleepCalled)
        assertEquals(2, server.requestCount)
    }

    // TC-R05: reportVideos 空 videos + searchResultEmpty=true 时 body 含 reason.search_result="empty"
    @Test
    fun `reportVideos_empty_videos_with_searchResultEmpty_includes_reason_in_body`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val result = reporter.reportVideos("task-empty", emptyList(), searchResultEmpty = true)

        assertTrue(result.success)

        val req = server.takeRequest()
        val body = req.body.readUtf8()
        assertTrue("body should contain reason", body.contains("reason"))
        assertTrue("body should contain search_result", body.contains("search_result"))
        assertTrue("body should contain empty", body.contains("empty"))
    }

    // TC-R06: reportCollect 发出 POST /collect/report，header 含 x-agent-id
    @Test
    fun `reportCollect_sends_POST_to_collect_report_with_agent_id_header`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val commenters = listOf(
            mapOf<String, Any?>("nickname" to "user1", "comment_text" to "hello"),
        )
        val result = reporter.reportCollect(
            taskId = "task-stage2-001",
            videoId = "video7890",
            commenters = commenters,
            terminal = false,
        )

        assertTrue(result.success)
        assertNull(result.code)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertTrue("path should contain /collect/report", req.path?.contains("/collect/report") == true)
        assertFalse("path should NOT contain report-videos", req.path?.contains("report-videos") == true)
        assertEquals("AGENT-TEST-001", req.getHeader("x-agent-id"))

        val body = req.body.readUtf8()
        assertTrue("body should contain task_id", body.contains("task-stage2-001"))
        assertTrue("body should contain video_id", body.contains("video7890"))
        assertTrue("body should contain commenters", body.contains("user1"))
    }

    // TC-R07: Bug C —— VideoInfo 带 shareUrl 时 body 含 share_url 短链（服务端据此解析真实 ID）
    @Test
    fun `reportVideos_includes_share_url_when_VideoInfo_has_shareUrl`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val reporter = makeReporter()
        val videos = listOf(
            CollectReporter.VideoInfo(video_id = "", keyword = "装修", shareUrl = "https://v.douyin.com/iRNBho6G/"),
        )
        val result = reporter.reportVideos("task-share", videos)

        assertTrue(result.success)

        val req = server.takeRequest()
        val body = req.body.readUtf8()
        assertTrue("body should contain share_url key", body.contains("share_url"))
        assertTrue("body should contain the short link", body.contains("https://v.douyin.com/iRNBho6G/"))
    }
}
