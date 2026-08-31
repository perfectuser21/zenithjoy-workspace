package com.zenithjoy.agent

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * FramePushLoop 单测 —— 上墙推流的契约。
 *
 * 覆盖：请求形状（URL / X-Agent-License 头 / image/jpeg 原始字节）、四种「不发请求」的
 * 短路（未配置 / 截不到帧 / 帧过大）、凭据被拒后的退避（别以 8fps 砸服务端）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FramePushLoopTest {

    private val server = MockWebServer()

    @Before
    fun setUp() { server.start() }

    @After
    fun tearDown() { server.shutdown() }

    private val agentUuid = "55f42f1e-9966-414d-9fab-475aa69d1396"
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0x01)

    private fun base() = server.url("/").toString().trimEnd('/')

    private fun makeLoop(
        uuid: String = agentUuid,
        license: String = "ZJ-F-A1B2C3D4",
        frame: () -> ByteArray? = { jpeg },
    ) = FramePushLoop(
        params = FramePushLoop.Params(httpBase = base(), licenseKey = license, agentUuid = uuid),
        scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
        frameProvider = frame,
        httpClient = OkHttpClient(),
    )

    @Test
    fun `帧推到 workers frame 端点，带 X-Agent-License 与 image jpeg 原始字节`() = runTest {
        server.enqueue(MockResponse().setResponseCode(202).setBody("""{"success":true,"data":{"seq":1}}"""))

        val result = makeLoop().pushOnce()

        assertEquals(FramePushLoop.Result.PUSHED, result)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/workers/$agentUuid/frame", req.path)
        assertEquals("ZJ-F-A1B2C3D4", req.getHeader("X-Agent-License"))
        assertTrue("Content-Type 应为 image/jpeg，实际 ${req.getHeader("Content-Type")}",
            (req.getHeader("Content-Type") ?: "").startsWith("image/jpeg"))
        assertArrayEqualsBytes(jpeg, req.body.readByteArray())
    }

    @Test
    fun `agentUuid 不是 uuid 时不发请求 —— 服务端只会 400，白跑一趟`() = runTest {
        val result = makeLoop(uuid = "xian-rog-agent").pushOnce()

        assertEquals(FramePushLoop.Result.SKIPPED_NOT_CONFIGURED, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `license 为空时不发请求`() = runTest {
        val result = makeLoop(license = "").pushOnce()

        assertEquals(FramePushLoop.Result.SKIPPED_NOT_CONFIGURED, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `截不到帧时不发请求 —— 未授权 or 单飞占用 or 黑屏都走这里`() = runTest {
        val result = makeLoop(frame = { null }).pushOnce()

        assertEquals(FramePushLoop.Result.SKIPPED_NO_FRAME, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `帧超过上限时本地就丢，不让服务端回 413`() = runTest {
        val huge = ByteArray(FramePushLoop.MAX_FRAME_BYTES + 1) { 0xFF.toByte() }

        val result = makeLoop(frame = { huge }).pushOnce()

        assertEquals(FramePushLoop.Result.SKIPPED_TOO_LARGE, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `403 跨租户视为 REJECTED —— 凭据问题重试无用`() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"code":"TENANT_MISMATCH"}}"""))

        assertEquals(FramePushLoop.Result.REJECTED, makeLoop().pushOnce())
    }

    @Test
    fun `401 无效凭据视为 REJECTED`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))

        assertEquals(FramePushLoop.Result.REJECTED, makeLoop().pushOnce())
    }

    @Test
    fun `服务端 500 视为 FAILED，不当成凭据问题`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500))

        assertEquals(FramePushLoop.Result.FAILED, makeLoop().pushOnce())
    }

    @Test
    fun `被拒后退避 —— 不能以推流帧率反复砸服务端`() {
        assertTrue(
            "REJECTED 必须退避到远大于正常帧间隔",
            FramePushLoop.nextDelayMs(FramePushLoop.Result.REJECTED, FramePushLoop.DEFAULT_INTERVAL_MS)
                >= FramePushLoop.REJECTED_BACKOFF_MS,
        )
        assertEquals(
            "正常推帧按帧率走",
            FramePushLoop.DEFAULT_INTERVAL_MS,
            FramePushLoop.nextDelayMs(FramePushLoop.Result.PUSHED, FramePushLoop.DEFAULT_INTERVAL_MS),
        )
        assertTrue(
            "未配置时不必按帧率空转，退避着等配置到位",
            FramePushLoop.nextDelayMs(FramePushLoop.Result.SKIPPED_NOT_CONFIGURED, FramePushLoop.DEFAULT_INTERVAL_MS)
                > FramePushLoop.DEFAULT_INTERVAL_MS,
        )
    }

    @Test
    fun `帧率默认在 6-15fps 之间 —— 够看到在动，又不至于把流量打爆`() {
        val fps = 1000.0 / FramePushLoop.DEFAULT_INTERVAL_MS
        assertTrue("实际 $fps fps", fps in 6.0..15.0)
        assertFalse("上限须小于服务端 120KB", FramePushLoop.MAX_FRAME_BYTES >= 120 * 1024)
    }

    private fun assertArrayEqualsBytes(expected: ByteArray, actual: ByteArray) {
        assertEquals("字节长度", expected.size, actual.size)
        for (i in expected.indices) assertEquals("第 $i 字节", expected[i], actual[i])
    }
}
