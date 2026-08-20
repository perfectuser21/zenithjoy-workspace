package com.zenithjoy.agent

import com.zenithjoy.agent.onboarding.ReadinessItem
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
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
 * **就绪不是一次性状态，是会掉的。**
 *
 * 两条历史实证都指向同一件事：`force-stop` 后 Android 会整体关闭无障碍（0717 真机复现）、
 * `adb install -r` 会静默撤销无障碍（0803 真机复现）。装机时绿了不代表明天还绿——
 * 只在 `initAgent()` 查一次并把结果做成快照上报，等于又造一个假绿。
 *
 * 所以 readiness 不能是 Params 里的静态字段，必须是**每次心跳前重新求值的 provider**。
 * 心跳本来就是 20 秒一次，复检借它的车，不额外加循环。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HttpHeartbeatLoopReadinessTest {

    private val server = MockWebServer()

    @Before fun setUp() { server.start() }
    @After fun tearDown() { server.shutdown() }

    private fun params(base: String) = HttpHeartbeatLoop.Params(
        httpBase = base,
        licenseKey = "ZJ-TEST",
        agentId = "agent-test",
        agentUuid = "",
        machineId = "machine-abc",
        hostname = "test-device",
        osType = "android",
        version = "test-version",
    )

    @Test
    fun `心跳 body 带上 readiness`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))

        val loop = HttpHeartbeatLoop(
            params = params(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            readinessProvider = { mapOf("accessibility" to ReadinessItem(ok = true)) },
        )
        loop.start()
        advanceTimeBy(100)
        loop.stop()

        val body = server.takeRequest().body.readUtf8()
        assertTrue("心跳必须带 readiness 字段", body.contains("\"readiness\""))
        assertTrue(body.contains("accessibility"))
    }

    // 核心：证明是「每次心跳重新求值」而不是「启动时拍一张快照」
    @Test
    fun `就绪状态中途变坏——下一次心跳必须反映出来，不许用启动时的快照`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))

        var accessibilityOk = true
        val loop = HttpHeartbeatLoop(
            params = params(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            readinessProvider = { mapOf("accessibility" to ReadinessItem(ok = accessibilityOk)) },
        )

        loop.sendOnce()
        val first = server.takeRequest().body.readUtf8()
        assertTrue("第一次应报 ok=true", first.contains("\"ok\":true"))

        // 模拟系统在运行中撤销了无障碍（force-stop / adb install -r 都会造成这个）
        accessibilityOk = false
        loop.sendOnce()
        val second = server.takeRequest().body.readUtf8()

        assertTrue("第二次必须报出 ok=false —— 用快照就会一直报 true，等于假绿", second.contains("\"ok\":false"))
    }

    @Test
    fun `没配 readinessProvider 时不带这个字段，向后兼容不影响老链路`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))

        val loop = HttpHeartbeatLoop(
            params = params(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
        )
        loop.sendOnce()

        val body = server.takeRequest().body.readUtf8()
        assertFalse(body.contains("\"readiness\""))
    }

    @Test
    fun `provider 抛异常不许把心跳带崩——心跳是客户机上唯一的远程视野`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"agent_id":"uuid-1"}"""))

        val loop = HttpHeartbeatLoop(
            params = params(server.url("/").toString().trimEnd('/')),
            scope = this,
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            readinessProvider = { error("boom") },
        )
        loop.sendOnce()

        val body = server.takeRequest().body.readUtf8()
        assertEquals("ZJ-TEST", Regex("\"license\":\"([^\"]+)\"").find(body)?.groupValues?.get(1))
        assertFalse("求值失败就不带这个字段，绝不阻断心跳", body.contains("\"readiness\""))
    }
}
