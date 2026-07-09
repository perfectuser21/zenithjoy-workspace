package com.zenithjoy.agent

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
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

    // TC-001: GET 请求携带 x-agent-id 头并命中 /pending-collect-tasks 路径
    @Test
    fun `pollOnce_carriesAgentIdHeader`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue MockResponse("""{"tasks":[],"total":0}""")
        // 2. 构造 AcquisitionCollectPollLoop(agentId="AG-TEST-001", ...)
        // 3. loop.start() + advanceTimeBy(100) + loop.stop()
        // 4. server.takeRequest() 验证:
        //    - method == "GET"
        //    - header("x-agent-id") == "AG-TEST-001"
        //    - path?.contains("pending-collect-tasks") == true
    }

    // TC-002: stage_1 任务触发 onStage1Task 回调，次数 = keywords.size
    @Test
    fun `pollOnce_stage1_invokesOnStage1TaskPerKeyword`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue 包含 stage:"stage_1", keywords:["词A","词B"] 的任务
        // 2. 记录 onStage1Task 调用次数
        // 3. 验证调用次数 == 2，且每次回调 task_id 正确
    }

    // TC-003: stage_2 任务触发 onStage2Task 回调并传入完整 video_urls 列表
    @Test
    fun `pollOnce_stage2_invokesOnStage2TaskWithVideoUrls`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue 包含 stage:"stage_2", video_urls:["https://www.douyin.com/video/v1","https://www.douyin.com/video/v2"] 的任务
        // 2. 记录 onStage2Task 回调参数
        // 3. 验证回调被调用一次，received?.video_urls == listOf("https://www.douyin.com/video/v1", "https://www.douyin.com/video/v2")
    }

    // TC-004: 空 tasks 列表，不触发任何回调
    @Test
    fun `pollOnce_emptyTasks_noCallbackInvoked`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue """{"tasks":[],"total":0}"""
        // 2. 注册 onStage1Task / onStage2Task / onCancel 均记录调用
        // 3. 验证三者调用次数均为 0
    }

    // TC-005: status:"cancelling" 任务，调用 onCancel，不调用 stage 回调
    @Test
    fun `pollOnce_cancellingStatus_invokesOnCancelOnly`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue 包含 stage:"stage_1", status:"cancelling" 的任务
        // 2. 验证 onCancel 被调用一次（task_id 匹配）
        // 3. 验证 onStage1Task 调用次数 == 0
        // 4. 验证 onStage2Task 调用次数 == 0
    }

    // TC-006: agentId 为空字符串，跳过 HTTP 请求（requestCount == 0）
    @Test
    fun `pollOnce_emptyAgentId_skipsRequest`() = runTest {
        TODO("implement")
        // 期望：
        // 1. 构造 AcquisitionCollectPollLoop(agentId="", ...)
        // 2. loop.start() + advanceTimeBy(100) + loop.stop()
        // 3. assertEquals(0, server.requestCount)
    }

    // TC-007: stage_1 任务，每关键词最多触发 N=3 次视频处理（MAX_VIDEOS_PER_KEYWORD=3）
    @Test
    fun `pollOnce_stage1_maxNVideosPerKeyword`() = runTest {
        TODO("implement")
        // 期望：
        // 本测试需配合 DouyinCollectService mock 或 onStage1Task 回调内置上限逻辑：
        // 1. 提供包含 1 个关键词的 stage_1 任务
        // 2. mock 视频搜索结果返回 5 张视频卡
        // 3. 验证实际处理（上报）的视频数 <= 3
    }

    // TC-008: HTTP 500 响应，不抛异常，不触发任何回调，循环可继续
    @Test
    fun `pollOnce_http500_doesNotCrash`() = runTest {
        TODO("implement")
        // 期望：
        // 1. enqueue MockResponse().setResponseCode(500)
        // 2. enqueue MockResponse().setBody("""{"tasks":[],"total":0}""")  // 第二轮正常
        // 3. pollOnce() 两次均不抛异常
        // 4. onStage1Task/onStage2Task/onCancel 调用次数 == 0
    }
}
