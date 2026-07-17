package com.zenithjoy.agent

import com.zenithjoy.agent.collect.CollectReporter
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Path2 全链路真实压测复现(2026-07-17 xian-rog)：Stage1 采集完成后 report-videos 静默
 * 卡死失败——CollectReporter.defaultClient() 还停留在 Bug1(#1345) 修复前的旧配置
 * （长时间空闲后 OkHttp 默认连接池里的连接被网络切换/NAT 超时静默弄坏，复用时写入
 * 成功但读永远拿不到响应），全仓库还有 4 处同款未修客户端——是系统性问题，不是
 * CollectReporter 一处孤立个案。本测试逐一锁定这几个低频调用客户端都不留旧连接可复用
 * （同 AgentServiceHttpClientTest 的验证方式：MockWebServer 断言 sequenceNumber=0）。
 */
class InfrequentHttpClientsNoPoolTest {

    private val server = MockWebServer()

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun assertNeverReusesConnection(client: okhttp3.OkHttpClient) {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val url = server.url("/ping")
        repeat(2) {
            client.newCall(Request.Builder().url(url).get().build()).execute().use { resp ->
                assertEquals(200, resp.code)
            }
        }
        val first = server.takeRequest()
        val second = server.takeRequest()
        assertEquals(0, first.sequenceNumber)
        assertEquals(
            "低频调用客户端不能复用连接——复用到静默失效的连接是本 bug 的病灶",
            0,
            second.sequenceNumber,
        )
    }

    @Test
    fun `CollectReporter 默认客户端不复用连接`() {
        assertNeverReusesConnection(CollectReporter.defaultClient())
    }

    @Test
    fun `AcquisitionCollectPollLoop 默认客户端不复用连接`() {
        assertNeverReusesConnection(AcquisitionCollectPollLoop.defaultClient())
    }

    @Test
    fun `AcquisitionKeywordPollLoop 默认客户端不复用连接`() {
        assertNeverReusesConnection(AcquisitionKeywordPollLoop.defaultClient())
    }

    @Test
    fun `AgentRegistrar 默认客户端不复用连接`() {
        assertNeverReusesConnection(AgentRegistrar.defaultClient())
    }

    @Test
    fun `ContentJudgmentService 默认客户端不复用连接`() {
        assertNeverReusesConnection(ContentJudgmentService.defaultClient())
    }
}
