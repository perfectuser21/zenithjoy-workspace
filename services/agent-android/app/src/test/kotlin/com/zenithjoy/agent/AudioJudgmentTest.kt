package com.zenithjoy.agent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 用户2026-07-17拍板（判定点 1d078987）：视频类内容判定改用真实音频转写，固定录制
 * 开头 20 秒系统音频（不管视频总长多少），丢给 Gemini 转写+判定，替代此前"只截一帧图"
 * 的判定方式——之前 AudioRecordService 只是个从未接线的孤儿骨架(录3秒且零调用点)，
 * 图文(note)类内容仍走原有截图路径不变（decision f3dbc2ce 明确 OCR 走图文、转写走视频）。
 */
class AudioJudgmentTest {

    // ── AudioRecordService 录制时长 ─────────────────────────────────────────
    @Test
    fun `AudioRecordService 录制时长固定20秒（不管视频总长多少）`() {
        assertEquals(20_000L, AudioRecordService.RECORD_DURATION_MS)
    }

    // ── captureTypeForVideoUrl：note走截图，video走音频 ──────────────────────
    @Test
    fun `note(图文)类型URL判定为screenshot`() {
        assertEquals("screenshot", captureTypeForVideoUrl("https://www.douyin.com/note/7123456789"))
    }

    @Test
    fun `video类型URL判定为audio`() {
        assertEquals("audio", captureTypeForVideoUrl("https://www.douyin.com/video/7123456789"))
    }

    // ── AudioCaptureService：镜像 ScreenCaptureService 的注入式可测试设计 ─────
    @Test
    fun `AudioCaptureService返回注入的captureImpl结果`() {
        val service = AudioCaptureService(captureImpl = { "fakeAudioBase64" })
        assertEquals("fakeAudioBase64", service.captureToBase64())
    }

    @Test
    fun `AudioCaptureService的captureImpl返回null时也返回null`() {
        val service = AudioCaptureService(captureImpl = { null })
        assertNull(service.captureToBase64())
    }

    // ── ContentJudgmentService：按 captureType 选对应的采集源 ─────────────────
    @Test
    fun `captureType=audio时ContentJudgmentService调用audioCaptureService不调用screenCaptureService`() {
        var screenCalled = false
        var audioCalled = false
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "" }, // 空 tenantId 直接短路返回 pending，不真发请求，只验证调用哪个 capture
            screenCaptureService = ScreenCaptureService(captureImpl = { screenCalled = true; "screenshotData" }),
            audioCaptureService = AudioCaptureService(captureImpl = { audioCalled = true; "audioData" }),
        )
        service.judge(videoId = "vid-audio-001", captureType = "audio", dataB64 = "")
        // tenantId 为空提前 return，两者都不该被调用——改用非空 tenantId 但指向假 server 更准确，
        // 这里只是先验证空 tenantId 分支确实提前短路，不误触发采集（防御性回归）。
        assertFalse(screenCalled)
        assertFalse(audioCalled)
    }

    @Test
    fun `captureType=audio且tenantId非空时真调用audioCaptureService不调用screenCaptureService`() {
        var screenCalled = false
        var audioCalled = false
        val client = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "tenant-1" },
            httpClient = client,
            screenCaptureService = ScreenCaptureService(captureImpl = { screenCalled = true; "screenshotData" }),
            audioCaptureService = AudioCaptureService(captureImpl = { audioCalled = true; "audioData" }),
        )
        service.judge(videoId = "vid-audio-002", captureType = "audio", dataB64 = "")
        assertTrue("captureType=audio 必须调用 audioCaptureService", audioCalled)
        assertFalse("captureType=audio 不该调用 screenCaptureService", screenCalled)
    }

    @Test
    fun `captureType=screenshot时仍调用screenCaptureService不调用audioCaptureService（不破坏图文路径）`() {
        var screenCalled = false
        var audioCalled = false
        val client = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "tenant-1" },
            httpClient = client,
            screenCaptureService = ScreenCaptureService(captureImpl = { screenCalled = true; "screenshotData" }),
            audioCaptureService = AudioCaptureService(captureImpl = { audioCalled = true; "audioData" }),
        )
        service.judge(videoId = "vid-note-001", captureType = "screenshot", dataB64 = "")
        assertTrue(screenCalled)
        assertFalse(audioCalled)
    }

    // ── AcquisitionCollectPollLoop：stage_2 按 URL 类型路由真实上报的 capture_type ──
    private val server = MockWebServer()

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `stage_2 对video链接上报capture_type=audio，对note链接上报capture_type=screenshot`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t1","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v001","https://www.douyin.com/note/n001"]}]}"""
            )
        )
        val capturedBodies = mutableListOf<String>()
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBodies.add(buffer.readUtf8())
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val judgmentService = ContentJudgmentService(
            agentId = { "AG-TEST-001" },
            httpBase = "http://localhost:9",
            tenantId = { "tenant-1" },
            httpClient = judgeClient,
            screenCaptureService = ScreenCaptureService(captureImpl = { "fakeScreenshotBase64" }),
            audioCaptureService = AudioCaptureService(captureImpl = { "fakeAudioBase64" }),
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-001" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = CoroutineScope(Dispatchers.Unconfined),
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { },
        )
        loop.pollOnce()

        assertEquals(2, capturedBodies.size)
        assertTrue(
            "video链接必须上报capture_type=audio: ${capturedBodies[0]}",
            capturedBodies[0].contains("\"capture_type\":\"audio\""),
        )
        assertTrue(
            "note链接必须上报capture_type=screenshot: ${capturedBodies[1]}",
            capturedBodies[1].contains("\"capture_type\":\"screenshot\""),
        )
    }

    @Test
    fun `stage_2响应体带video_titles时judge-video请求体透传对应title`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t2","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v002"],
                    "video_titles":{"v002":"真实标题测试样本"}}]}"""
            )
        )
        val capturedBodies = mutableListOf<String>()
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBodies.add(buffer.readUtf8())
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val judgmentService = ContentJudgmentService(
            agentId = { "AG-TEST-002" },
            httpBase = "http://localhost:9",
            tenantId = { "tenant-1" },
            httpClient = judgeClient,
            screenCaptureService = ScreenCaptureService(captureImpl = { "fakeScreenshotBase64" }),
            audioCaptureService = AudioCaptureService(captureImpl = { "fakeAudioBase64" }),
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-002" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = CoroutineScope(Dispatchers.Unconfined),
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { },
        )
        loop.pollOnce()

        assertEquals(1, capturedBodies.size)
        assertTrue(
            "video_titles里对应videoId的title必须透传进judge-video请求体: ${capturedBodies[0]}",
            capturedBodies[0].contains("\"title\":\"真实标题测试样本\""),
        )
    }

    @Test
    fun `video_titles缺少某videoId时不报错也不带title字段`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t3","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v003"],
                    "video_titles":{}}]}"""
            )
        )
        val capturedBodies = mutableListOf<String>()
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBodies.add(buffer.readUtf8())
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val judgmentService = ContentJudgmentService(
            agentId = { "AG-TEST-003" },
            httpBase = "http://localhost:9",
            tenantId = { "tenant-1" },
            httpClient = judgeClient,
            screenCaptureService = ScreenCaptureService(captureImpl = { "fakeScreenshotBase64" }),
            audioCaptureService = AudioCaptureService(captureImpl = { "fakeAudioBase64" }),
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-003" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = CoroutineScope(Dispatchers.Unconfined),
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { },
        )
        loop.pollOnce()

        assertEquals(1, capturedBodies.size)
        assertFalse(
            "video_titles里没有的videoId不应该带title字段: ${capturedBodies[0]}",
            capturedBodies[0].contains("\"title\""),
        )
    }
}
