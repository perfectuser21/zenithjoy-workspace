package com.zenithjoy.agent

import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * 真机复现(2026-07-17 xian-rog)：AgentService.httpClient 长时间运行后，dm-outreach-result
 * 回执上报稳定卡满 15s connectTimeout 后超时失败——设备用系统 curl 直打同一 endpoint <1s 能通，
 * force-stop 重启 App(新建连接池)后立刻恢复 200 快速响应。根因：httpClient 供极低频调用
 * （报告类端点数分钟一次），OkHttp 默认连接池把空闲连接保留 5 分钟，长时间无调用后网络切换/
 * NAT 超时会让池里的连接静默失效，下次复用时写入成功但读永远拿不到响应，直到 readTimeout 才
 * 报错。HttpHeartbeatLoop 用的是【独立的】OkHttpClient 实例，靠自己每 20s 一次的高频调用保持
 * 连接常新，从不受影响——两者互不共享连接池，这正是"心跳一直正常、回执一直 timeout"的原因。
 *
 * 修复：AgentService.buildReportHttpClient() 把 maxIdleConnections 设为 0，让这个低频客户端
 * 每次调用都开新连接，不留旧连接可复用，从根上消除"复用到已静默失效的连接"这整类问题。
 */
class AgentServiceHttpClientTest {

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
    fun `report http client never reuses a pooled connection across calls`() {
        val client = AgentService.buildReportHttpClient()
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
        // sequenceNumber==0 means the request started a brand-new connection
        // （非 0 = 复用了同一条已建立的连接，正是本 bug 的病灶）。
        assertEquals(0, first.sequenceNumber)
        assertEquals(
            "第二次调用不能复用第一次的连接——复用是本 bug 的病灶（僵尸连接被复用后写入卡死等读超时）",
            0,
            second.sequenceNumber,
        )
    }

    @Test
    fun `report http client keeps the existing 15s connect and read timeouts`() {
        val client = AgentService.buildReportHttpClient()
        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(15_000, client.readTimeoutMillis)
    }
}
