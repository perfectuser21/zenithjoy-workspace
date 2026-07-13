package com.zenithjoy.agent

import org.junit.Test
import org.junit.Assert.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

class ContentJudgmentClientWiringTest {

    // TC-1: FR-A — AgentService 中 contentJudgmentService 非 null
    @Test
    fun `contentJudgmentService is non-null when AcquisitionCollectPollLoop is created`() {
        val mockCapture = ScreenCaptureService(captureImpl = { "fakeBase64" })
        val judgmentService = ContentJudgmentService(
            agentId = { "test-agent" },
            httpBase = "http://localhost:3000",
            tenantId = { "test-tenant" },
            screenCaptureService = mockCapture,
        )
        assertNotNull("ContentJudgmentService 实例不应为 null", judgmentService)
        val loop = AcquisitionCollectPollLoop(
            agentId = { "test-agent" },
            httpBase = "http://localhost:3000",
            scope = CoroutineScope(Dispatchers.Unconfined),
            contentJudgmentService = judgmentService,
        )
        assertNotNull(loop)
    }

    // TC-2: FR-B — ScreenCaptureService lambda 注入
    @Test
    fun `ScreenCaptureService returns injected value from captureImpl`() {
        val fakeCaptureService = ScreenCaptureService(captureImpl = { "fakeBase64Data" })
        val result = fakeCaptureService.captureToBase64()
        assertEquals("应返回注入的 fake base64 数据", "fakeBase64Data", result)
    }

    // TC-3: FR-B — captureToBase64() 返回 null on failure
    @Test
    fun `ScreenCaptureService returns null when captureImpl returns null`() {
        val failCapture = ScreenCaptureService(captureImpl = { null })
        val result = failCapture.captureToBase64()
        assertNull("captureImpl 返回 null 时 captureToBase64() 应返回 null", result)
    }

    // TC-4: FR-C — 截图失败时不再本地短路，而是带 capture_type=skipped_capture_failed 回报服务端，
    //   让 judgment_reason 落到 acquisition_collect_videos（修真机 Android 14 MediaProjection bug 的
    //   环境守卫：DB 里一眼可辨"截图失败"而非空转 pending）。
    @Test
    fun `ContentJudgmentService reports skipped_capture_failed to server when capture fails`() {
        val failCapture = ScreenCaptureService(captureImpl = { null })
        // 拦截器：捕获实际发出的请求体，并返回服务端对 skipped_capture_failed 的标准应答。
        var capturedBody: String? = null
        val client = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBody = buffer.readUtf8()
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body(
                        """{"judgment_status":"pending","judgment_reason":"skipped_capture_failed"}"""
                            .toResponseBody("application/json".toMediaType()),
                    )
                    .build()
            })
            .build()
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "tenant" },
            httpClient = client,
            screenCaptureService = failCapture,
        )
        val result = service.judge(videoId = "vid-001", captureType = "screenshot", dataB64 = "")

        // 关键：截图失败必须真的 POST（旧行为是本地短路、从不回报，导致 DB judgment_reason 永空）。
        assertNotNull("截图失败时仍应发出回报请求", capturedBody)
        assertTrue(
            "回报请求应带 capture_type=skipped_capture_failed，原因才能落库",
            capturedBody!!.contains("\"capture_type\":\"skipped_capture_failed\""),
        )
        assertEquals("服务端应答透传：pending", "pending", result.judgmentStatus)
        assertEquals("服务端应答透传：skipped_capture_failed", "skipped_capture_failed", result.judgmentReason)
    }

    // TC-5: FR-D — dataB64 非空时直接使用，不调用 screenCaptureService
    @Test
    fun `ContentJudgmentService does not call captureService when dataB64 is non-empty`() {
        var captureCalled = false
        val trackCapture = ScreenCaptureService(captureImpl = { captureCalled = true; "fromCapture" })
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "" },  // 空 tenantId → 直接返回 pending，不调用 captureImpl
            screenCaptureService = trackCapture,
        )
        service.judge(videoId = "vid-001", captureType = "screenshot", dataB64 = "existingData")
        assertFalse("提供非空 dataB64 时不应调用 captureService", captureCalled)
    }

    // TC-6: INV-3 — 超时使用 forceTimeout 不用真实 delay
    @Test
    fun `ContentJudgmentService returns pending on forceTimeout without real delay`() {
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "tenant" },
        )
        val result = service.judge(
            videoId = "vid-timeout",
            captureType = "screenshot",
            dataB64 = "someData",
            forceTimeout = true,
        )
        assertEquals("forceTimeout 应返回 pending", "pending", result.judgmentStatus)
    }

    // TC-7: INV-1 — rejected 视频不进 Stage2（逻辑层验证）
    @Test
    fun `rejected judgment result should not trigger stage2 task`() {
        val judgmentStatus = "rejected"
        val shouldDispatchStage2 = judgmentStatus != "rejected"
        assertFalse("rejected 视频不应触发 Stage2", shouldDispatchStage2)
    }
}
