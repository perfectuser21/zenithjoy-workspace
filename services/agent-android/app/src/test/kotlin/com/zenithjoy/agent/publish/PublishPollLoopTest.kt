package com.zenithjoy.agent.publish

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * 刀A（发布基座段）：PublishPollLoop 的判别与失败分支契约。
 *
 * 该 loop 是 agent 第 4 条轮询线：GET /api/publish-tasks?status=queued（X-Upload-Token
 * 鉴权，与 AI 执行器同一凭据）→ 逐单 POST /:id/claim（CAS 抢单，claimed=false 就跳过，
 * 多机同租户不重复下载）→ claimed=true 才 GET /:id/package → 逐 media 流式下载到
 * cacheDir → 落相册 → 清 cache；claim 之后任何失败必须 PATCH failed 回执（fail-visible，
 * 编排台立刻看到派发失败，绝不静默留 dispatched 黑洞）。
 */
class PublishPollLoopTest {

    private val server = MockWebServer()
    private lateinit var cacheDir: File

    private val taskId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

    @Before
    fun setUp() {
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "publish-poll-test-${System.nanoTime()}")
        check(cacheDir.mkdirs()) { "无法创建测试 cacheDir" }
    }

    @After
    fun tearDown() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private data class SaverCall(val fileName: String, val mimeType: String?, val contentAtCall: String)

    @Suppress("OPT_IN_USAGE")
    private fun makeLoop(
        saverCalls: MutableList<SaverCall> = mutableListOf(),
        saverResult: Boolean = true,
        licenseKey: () -> String = { "ZJ-F-TEST0001" },
    ) = PublishPollLoop(
        licenseKey = licenseKey,
        httpBase = server.url("/").toString().trimEnd('/'),
        scope = kotlinx.coroutines.GlobalScope,
        cacheDir = cacheDir,
        saveToGallery = { file, fileName, mimeType ->
            saverCalls.add(SaverCall(fileName, mimeType, file.readText()))
            saverResult
        },
        intervalMs = Long.MAX_VALUE,
        httpClient = OkHttpClient(),
        sleepFn = {},
    )

    /** 按路径路由的 MockWebServer dispatcher：一次 poll 会打多个不同端点。 */
    private fun installDispatcher(
        listBody: String,
        claimBody: String? = null,
        packageBody: String? = null,
        mediaResponse: MockResponse? = null,
    ) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: return MockResponse().setResponseCode(404)
                return when {
                    path.startsWith("/api/publish-tasks?") ->
                        MockResponse().setResponseCode(200).setBody(listBody)
                    path.endsWith("/claim") && claimBody != null ->
                        MockResponse().setResponseCode(200).setBody(claimBody)
                    path.endsWith("/package") && packageBody != null ->
                        MockResponse().setResponseCode(200).setBody(packageBody)
                    path.endsWith("/receipt") ->
                        MockResponse().setResponseCode(200)
                            .setBody("""{"success":true,"data":{"task_id":"$taskId","status":"failed"}}""")
                    path.startsWith("/media/") && mediaResponse != null -> mediaResponse
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    private fun drainRecordedRequests(): List<RecordedRequest> =
        (0 until server.requestCount).map { server.takeRequest() }

    private fun listBodyWith(vararg ids: String): String {
        val items = ids.joinToString(",") {
            """{"id":"$it","platform":"douyin","type":"image","status":"queued","created_at":"now"}"""
        }
        return """{"success":true,"data":{"items":[$items]}}"""
    }

    @Test
    fun `queued 空列表 - 只发一次列表请求且零动作`() {
        installDispatcher(listBody = """{"success":true,"data":{"items":[]}}""")
        val saverCalls = mutableListOf<SaverCall>()

        makeLoop(saverCalls).pollOnce()

        val requests = drainRecordedRequests()
        assertEquals("空列表只应有 1 次列表请求", 1, requests.size)
        assertEquals("GET", requests[0].method)
        assertEquals("/api/publish-tasks?status=queued", requests[0].path)
        assertEquals(
            "鉴权必须走 X-Upload-Token: licenseKey（与 AI 执行器同一凭据，不新造第四套）",
            "ZJ-F-TEST0001",
            requests[0].getHeader("X-Upload-Token"),
        )
        assertTrue("零动作：saver 不应被调用", saverCalls.isEmpty())
    }

    @Test
    fun `claim 返回 claimed=false - 跳过该单不领包不回执`() {
        installDispatcher(
            listBody = listBodyWith(taskId),
            claimBody = """{"success":true,"data":{"claimed":false,"status":"dispatched"}}""",
        )
        val saverCalls = mutableListOf<SaverCall>()

        makeLoop(saverCalls).pollOnce()

        val requests = drainRecordedRequests()
        assertEquals("应只有 列表 + claim 两次请求", 2, requests.size)
        assertEquals("POST", requests[1].method)
        assertEquals("/api/publish-tasks/$taskId/claim", requests[1].path)
        assertEquals("ZJ-F-TEST0001", requests[1].getHeader("X-Upload-Token"))
        assertTrue("没抢到不许领包", requests.none { it.path?.endsWith("/package") == true })
        assertTrue("没抢到零副作用，不许回执", requests.none { it.path?.endsWith("/receipt") == true })
        assertTrue("saver 不应被调用", saverCalls.isEmpty())
    }

    @Test
    fun `claim 成功 - 领包下载落相册并清理 cache 不回执`() {
        installDispatcher(
            listBody = listBodyWith(taskId),
            claimBody = """{"success":true,"data":{"claimed":true}}""",
            packageBody = """{"success":true,"data":{"content_id":"c1","title":"今日份的治愈色",
                |"body":"生活需要一点渐变","content_type":"image","platform":"douyin",
                |"media":[{"url":"${server.url("/media/a.jpg")}","file_name":"a.jpg","mime_type":"image/jpeg"}]}}""".trimMargin(),
            mediaResponse = MockResponse().setResponseCode(200).setBody("JPEGDATA"),
        )
        val saverCalls = mutableListOf<SaverCall>()

        makeLoop(saverCalls).pollOnce()

        assertEquals("saver 应被调用恰好一次", 1, saverCalls.size)
        assertEquals("a.jpg", saverCalls[0].fileName)
        assertEquals("image/jpeg", saverCalls[0].mimeType)
        assertEquals("落相册时 cache 文件内容必须是下载的完整字节", "JPEGDATA", saverCalls[0].contentAtCall)

        assertEquals(
            "落相册成功后必须清理 cache 临时文件（视频可能几百 MB，攒着会撑爆存储）",
            0,
            cacheDir.listFiles()?.size ?: -1,
        )
        val requests = drainRecordedRequests()
        assertTrue("列表→claim→package→media 全链路应命中", requests.any { it.path?.endsWith("/package") == true })
        assertTrue(
            "基座段成功不回执——终态回执由执行发布的一方（AI 执行器）回",
            requests.none { it.path?.endsWith("/receipt") == true },
        )
    }

    @Test
    fun `下载失败 - PATCH failed 回执且 saver 不被调用`() {
        installDispatcher(
            listBody = listBodyWith(taskId),
            claimBody = """{"success":true,"data":{"claimed":true}}""",
            packageBody = """{"success":true,"data":{"content_id":"c1","title":"t","body":"b",
                |"content_type":"image","platform":"douyin",
                |"media":[{"url":"${server.url("/media/broken.jpg")}","file_name":"broken.jpg","mime_type":"image/jpeg"}]}}""".trimMargin(),
            mediaResponse = MockResponse().setResponseCode(500).setBody("boom"),
        )
        val saverCalls = mutableListOf<SaverCall>()

        makeLoop(saverCalls).pollOnce()

        val requests = drainRecordedRequests()
        val receipt = requests.firstOrNull { it.path?.endsWith("/receipt") == true }
        assertTrue("claim 后下载失败必须 fail-visible：PATCH /:id/receipt", receipt != null)
        assertEquals("PATCH", receipt!!.method)
        assertEquals("/api/publish-tasks/$taskId/receipt", receipt.path)
        val body = receipt.body.readUtf8()
        assertTrue("回执 result 必须是 failed，实际 body=$body", body.contains("\"result\":\"failed\""))
        assertTrue("回执 detail 必须写明哪步失败（下载），实际 body=$body", body.contains("下载"))
        assertTrue("下载失败不许调 saver", saverCalls.isEmpty())
        assertEquals("失败路径同样要清理 cache 残片", 0, cacheDir.listFiles()?.size ?: -1)
    }

    @Test
    fun `licenseKey 为空 - 不发任何请求`() {
        installDispatcher(listBody = """{"success":true,"data":{"items":[]}}""")

        makeLoop(licenseKey = { "" }).pollOnce()

        assertEquals("未配置 license 时不许打接口", 0, server.requestCount)
    }

    @Test
    fun `落相册失败 - PATCH failed 回执且 detail 写明落相册`() {
        installDispatcher(
            listBody = listBodyWith(taskId),
            claimBody = """{"success":true,"data":{"claimed":true}}""",
            packageBody = """{"success":true,"data":{"content_id":"c1","title":"t","body":"b",
                |"content_type":"image","platform":"douyin",
                |"media":[{"url":"${server.url("/media/a.jpg")}","file_name":"a.jpg","mime_type":"image/jpeg"}]}}""".trimMargin(),
            mediaResponse = MockResponse().setResponseCode(200).setBody("JPEGDATA"),
        )
        val saverCalls = mutableListOf<SaverCall>()

        makeLoop(saverCalls, saverResult = false).pollOnce()

        val requests = drainRecordedRequests()
        val receipt = requests.firstOrNull { it.path?.endsWith("/receipt") == true }
        assertTrue("落相册失败必须 fail-visible：PATCH /:id/receipt", receipt != null)
        val body = receipt!!.body.readUtf8()
        assertTrue("回执 result 必须是 failed，实际 body=$body", body.contains("\"result\":\"failed\""))
        assertTrue("回执 detail 必须写明哪步失败（落相册），实际 body=$body", body.contains("落相册"))
        assertFalse("失败路径不许把 cache 残片留在磁盘", cacheDir.listFiles()?.isNotEmpty() ?: false)
    }
}
