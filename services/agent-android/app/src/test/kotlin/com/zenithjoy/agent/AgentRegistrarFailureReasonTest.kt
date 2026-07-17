package com.zenithjoy.agent

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 真机排障 2026-07-17：用户下载安卓 App、输入 License Key 后，页面只显示"未注册"，
 * 没有任何原因。AgentRegistrar.register() 此前失败一律返回 null，AgentService 只在
 * logcat 打一行 warning——没有 adb 的普通用户/员工完全无法知道到底是格式错、License
 * 不存在、配额用满还是网络问题。本次把失败原因一路带回 UI（见 MainActivity 状态页）。
 */
class AgentRegistrarFailureReasonTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun request(licenseKey: String = "ZJ-F-A1B2C3D4") = AgentRegistrar.RegisterRequest(
        licenseKey = licenseKey,
        machineId = "test-machine-0001",
        hostname = "test-hostname",
        agentId = "agent-test-0001",
        version = "9.9.9-test",
        httpBase = server.url("/").toString().trimEnd('/'),
    )

    private fun registrar() = AgentRegistrar(
        httpClient = OkHttpClient.Builder().build(),
    )

    @Test
    fun `200 成功响应返回 Success 并带上 ws_token`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"ok":true,"ws_token":"tok-abc","registered_machine_id":"test-machine-0001","tier":"free","max_machines":1,"agent_id":"uuid-1"}"""
            )
        )
        val outcome = registrar().register(request())
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Success)
        assertEquals("tok-abc", (outcome as AgentRegistrar.RegisterOutcome.Success).result.wsToken)
    }

    @Test
    fun `400格式不合法 返回 Failure 并携带服务端中文原因`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(400).setBody(
                """{"ok":false,"code":"BAD_REQUEST","message":"license_key 格式不合法（应为 ZJ-X-XXXXXXXX）"}"""
            )
        )
        val outcome = registrar().register(request(licenseKey = "ZJ-BADFORMAT"))
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Failure)
        assertEquals(
            "license_key 格式不合法（应为 ZJ-X-XXXXXXXX）",
            (outcome as AgentRegistrar.RegisterOutcome.Failure).reason,
        )
    }

    @Test
    fun `401 License不存在 返回 Failure 并携带原因`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401).setBody(
                """{"ok":false,"code":"INVALID_LICENSE","message":"License key 不存在"}"""
            )
        )
        val outcome = registrar().register(request())
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Failure)
        assertEquals("License key 不存在", (outcome as AgentRegistrar.RegisterOutcome.Failure).reason)
    }

    @Test
    fun `403配额用满 返回 Failure 并携带原因`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(403).setBody(
                """{"ok":false,"code":"QUOTA_EXCEEDED","message":"装机数已达上限 1（free）"}"""
            )
        )
        val outcome = registrar().register(request())
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Failure)
        assertEquals("装机数已达上限 1（free）", (outcome as AgentRegistrar.RegisterOutcome.Failure).reason)
    }

    @Test
    fun `服务端返回体没有message字段时按code给出兜底中文提示`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(403).setBody("""{"ok":false,"code":"SUSPENDED"}"""),
        )
        val outcome = registrar().register(request())
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Failure)
        val reason = (outcome as AgentRegistrar.RegisterOutcome.Failure).reason
        assertTrue("兜底文案应提及暂停，实际：$reason", reason.contains("暂停"))
    }

    @Test
    fun `网络连接失败返回 Failure 并说明是网络错误`() = runTest {
        server.shutdown()
        val outcome = registrar().register(request())
        assertTrue(outcome is AgentRegistrar.RegisterOutcome.Failure)
        val reason = (outcome as AgentRegistrar.RegisterOutcome.Failure).reason
        assertTrue("应说明是网络错误，实际：$reason", reason.contains("网络"))
    }

    @Test
    fun `License Key 格式校验对齐后端正则`() {
        assertTrue(AgentConfig.isValidLicenseKeyFormat("ZJ-F-A1B2C3D4"))
        assertTrue(AgentConfig.isValidLicenseKeyFormat("ZJ-E-00000000"))
        org.junit.Assert.assertFalse(AgentConfig.isValidLicenseKeyFormat("ZJ-XXXX"))
        org.junit.Assert.assertFalse(AgentConfig.isValidLicenseKeyFormat("ZJ-Z-A1B2C3D4"))
        org.junit.Assert.assertFalse(AgentConfig.isValidLicenseKeyFormat(""))
        org.junit.Assert.assertFalse(AgentConfig.isValidLicenseKeyFormat("zj-f-a1b2c3d4"))
    }
}
