package com.zenithjoy.agent

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 回归（handoff 0715 判决门截图时序反，Brain issue 2b85b616）。
 *
 * 真根因：stage_2 过滤视频时直接对着当前屏幕截图判决，中间没有"先打开这个视频"的动作——
 * 截的是搜索结果页，不是目标视频。修法：AcquisitionCollectPollLoop 新增可选 videoOpener
 * 回调，stage_2 filter 对每个候选视频先调 videoOpener(videoId) 再调 judge()，
 * 保证判决截图时视频已经打开。videoOpener=null（默认）保持旧行为不变，向后兼容。
 */
class AcquisitionCollectPollLoopVideoOpenerTest {

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
    fun `stage_2 filter opens video before judging it — order must be open-then-judge per video`() {
        val callOrder = mutableListOf<String>()

        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t1","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v001","https://www.douyin.com/video/v002"]}]}"""
            )
        )

        // 判决网络调用本身也记入 callOrder，证明 videoOpener 真的先于 judge 的实际请求发生。
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                callOrder.add("judge-network-call")
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
        )

        val openedVideoIds = mutableListOf<String>()
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-001" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = kotlinx.coroutines.GlobalScope,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { videoId ->
                callOrder.add("open:$videoId")
                openedVideoIds.add(videoId)
            },
        )

        loop.pollOnce()

        assertEquals(
            "两个候选视频都必须先被打开",
            listOf("v001", "v002"),
            openedVideoIds,
        )
        // 每个视频：open 必须先于该视频对应的 judge 网络调用
        assertEquals(
            "顺序必须是 open→judge→open→judge，不能截图先于打开",
            listOf("open:v001", "judge-network-call", "open:v002", "judge-network-call"),
            callOrder,
        )
    }

    @Test
    fun `videoOpener=null keeps old behavior — judge still called without opening (backward compat)`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t1","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v001"]}]}"""
            )
        )
        var judgeCalled = false
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                judgeCalled = true
                Response.Builder()
                    .request(chain.request())
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
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-001" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = kotlinx.coroutines.GlobalScope,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            // videoOpener 不传 → 默认 null
        )
        loop.pollOnce()
        assertTrue("videoOpener=null 时 judge 仍应被调用（旧行为不变）", judgeCalled)
    }
}
