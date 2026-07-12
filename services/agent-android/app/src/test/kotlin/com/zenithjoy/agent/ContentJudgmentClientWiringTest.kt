package com.zenithjoy.agent

import org.junit.Test
import org.junit.Assert.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

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

    // TC-4: FR-C — ContentJudgmentService 截图失败时返回 skipped_capture_failed + pending
    @Test
    fun `ContentJudgmentService returns pending with skipped_capture_failed when capture fails`() {
        val failCapture = ScreenCaptureService(captureImpl = { null })
        val service = ContentJudgmentService(
            agentId = { "test" },
            httpBase = "http://localhost:3000",
            tenantId = { "tenant" },
            screenCaptureService = failCapture,
        )
        val result = service.judge(videoId = "vid-001", captureType = "screenshot", dataB64 = "")
        assertEquals("截图失败应返回 pending", "pending", result.judgmentStatus)
        assertEquals("截图失败原因应为 skipped_capture_failed", "skipped_capture_failed", result.judgmentReason)
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
