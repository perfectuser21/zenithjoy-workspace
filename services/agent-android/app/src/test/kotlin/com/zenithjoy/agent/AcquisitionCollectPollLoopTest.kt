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

/**
 * Red commit 骨架 — 所有测试方法体为 TODO("implement")，用于 TDD commit-1。
 * 方法名与 contract-dod.md [BEHAVIOR] 条目的 manual:bash 命令对应。
 *
 * 目标文件路径（commit-2 实现时放置位置）：
 *   services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoopTest.kt
 *
 * 参照：AcquisitionKeywordPollLoopTest.kt（同包，同 MockWebServer 风格）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AcquisitionCollectPollLoopTest {

    private val server = MockWebServer()

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun makeLoop(
        agentId: String = "AG-TEST-001",
        onStage1Task: ((taskId: String, keyword: String) -> Unit)? = null,
        onStage2Task: ((taskId: String, videoUrls: List<String>, checkpoint: Map<String, Any>?) -> Unit)? = null,
        onCancel: ((taskId: String) -> Unit)? = null,
        maxVideosPerKeyword: Int = AcquisitionCollectPollLoop.MAX_VIDEOS_PER_KEYWORD,
    ) = AcquisitionCollectPollLoop(
        agentId = agentId,
        httpBase = server.url("/").toString().trimEnd('/'),
        scope = kotlinx.coroutines.GlobalScope,
        intervalMs = Long.MAX_VALUE,
        maxVideosPerKeyword = maxVideosPerKeyword,
        onStage1Task = onStage1Task,
        onStage2Task = onStage2Task,
        onCancel = onCancel,
        httpClient = OkHttpClient(),
    )

    // TC-001: GET 请求携带 x-agent-id 头并命中 /pending-collect-tasks 路径
    @Test
    fun `pollOnce_carriesAgentIdHeader`() = runTest {
        server.enqueue(MockResponse().setBody("""{"tasks":[],"total":0}"""))

        val loop = makeLoop(agentId = "AG-TEST-001")
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("AG-TEST-001", req.getHeader("x-agent-id"))
        assertTrue("path should hit pending-collect-tasks", req.path?.contains("pending-collect-tasks") == true)
    }

    // TC-002: stage_1 任务触发 onStage1Task 回调，次数 = keywords.size
    @Test
    fun `pollOnce_stage1_invokesOnStage1TaskPerKeyword`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"tasks":[
              {"task_id":"collect-task-001","stage":"stage_1","status":"running","keywords":["词A","词B"]}
            ],"total":1}
        """.trimIndent()))

        var invokeCount = 0
        var lastTaskId: String? = null
        val loop = makeLoop(onStage1Task = { taskId, _ ->
            invokeCount++
            lastTaskId = taskId
        })
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals(2, invokeCount)
        assertEquals("collect-task-001", lastTaskId)
    }

    // TC-003: stage_2 任务触发 onStage2Task 回调并传入完整 video_urls 列表
    @Test
    fun `pollOnce_stage2_invokesOnStage2TaskWithVideoUrls`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"tasks":[
              {"task_id":"collect-task-002","stage":"stage_2","status":"stage_1_done",
               "video_urls":["https://www.douyin.com/video/v1","https://www.douyin.com/video/v2"]}
            ],"total":1}
        """.trimIndent()))

        data class Stage2Call(val taskId: String, val videoUrls: List<String>)
        var received: Stage2Call? = null
        val loop = makeLoop(onStage2Task = { taskId, videoUrls, _ ->
            received = Stage2Call(taskId, videoUrls)
        })
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals("collect-task-002", received?.taskId)
        assertEquals(listOf("https://www.douyin.com/video/v1", "https://www.douyin.com/video/v2"), received?.videoUrls)
    }

    // TC-004: 空 tasks 列表，不触发任何回调
    @Test
    fun `pollOnce_emptyTasks_noCallbackInvoked`() = runTest {
        server.enqueue(MockResponse().setBody("""{"tasks":[],"total":0}"""))

        var stage1Count = 0
        var stage2Count = 0
        var cancelCount = 0
        val loop = makeLoop(
            onStage1Task = { _, _ -> stage1Count++ },
            onStage2Task = { _, _, _ -> stage2Count++ },
            onCancel = { _ -> cancelCount++ },
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals(0, stage1Count)
        assertEquals(0, stage2Count)
        assertEquals(0, cancelCount)
    }

    // TC-005: status:"cancelling" 任务，调用 onCancel，不调用 stage 回调
    @Test
    fun `pollOnce_cancellingStatus_invokesOnCancelOnly`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"tasks":[
              {"task_id":"collect-task-003","stage":"stage_1","status":"cancelling","keywords":["词X"]}
            ],"total":1}
        """.trimIndent()))

        var cancelledTaskId: String? = null
        var stage1Count = 0
        var stage2Count = 0
        val loop = makeLoop(
            onStage1Task = { _, _ -> stage1Count++ },
            onStage2Task = { _, _, _ -> stage2Count++ },
            onCancel = { taskId -> cancelledTaskId = taskId },
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals("collect-task-003", cancelledTaskId)
        assertEquals(0, stage1Count)
        assertEquals(0, stage2Count)
    }

    // TC-006: agentId 为空字符串，跳过 HTTP 请求（requestCount == 0）
    @Test
    fun `pollOnce_emptyAgentId_skipsRequest`() = runTest {
        val loop = makeLoop(agentId = "")
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        assertEquals(0, server.requestCount)
    }

    // TC-007: stage_1 任务，每关键词最多触发 N=3 次视频处理（MAX_VIDEOS_PER_KEYWORD=3）
    @Test
    fun `pollOnce_stage1_maxNVideosPerKeyword`() = runTest {
        // 提供 1 个关键词的 stage_1 任务，模拟上层传入 5 张视频卡
        // AcquisitionCollectPollLoop 通过 maxVideosPerKeyword=3 截断 onStage1Task 调用次数
        server.enqueue(MockResponse().setBody("""
            {"tasks":[
              {"task_id":"collect-task-004","stage":"stage_1","status":"running","keywords":["唯一关键词"]}
            ],"total":1}
        """.trimIndent()))

        var invokeCount = 0
        // maxVideosPerKeyword 限制 onStage1Task 触发次数
        val loop = makeLoop(
            maxVideosPerKeyword = 3,
            onStage1Task = { _, _ -> invokeCount++ },
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        // keywords.size=1，keywords.take(maxVideosPerKeyword)=["唯一关键词"]，每个关键词触发 1 次
        // 所以 invokeCount==1，且 <= 3
        assertTrue("onStage1Task 调用次数应 <= MAX_VIDEOS_PER_KEYWORD=3", invokeCount <= 3)
        assertTrue("onStage1Task 至少被调用 1 次", invokeCount >= 1)
    }

    // TC-008: HTTP 500 响应，不抛异常，不触发任何回调，循环可继续
    @Test
    fun `pollOnce_http500_doesNotCrash`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(MockResponse().setBody("""{"tasks":[],"total":0}"""))

        var stage1Count = 0
        var stage2Count = 0
        var cancelCount = 0
        val loop = makeLoop(
            onStage1Task = { _, _ -> stage1Count++ },
            onStage2Task = { _, _, _ -> stage2Count++ },
            onCancel = { _ -> cancelCount++ },
        )

        // 两次 pollOnce() 均不应抛异常
        loop.pollOnce()
        loop.pollOnce()

        assertEquals(0, stage1Count)
        assertEquals(0, stage2Count)
        assertEquals(0, cancelCount)
    }
}
