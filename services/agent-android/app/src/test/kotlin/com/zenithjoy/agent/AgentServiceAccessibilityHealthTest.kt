package com.zenithjoy.agent

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机复现(2026-07-17 xian-rog)：force-stop 重启 App 会被 Android 系统级整体关闭无障碍服务
 * （`accessibility_enabled=0`），且没有任何显式报错——DouyinCollectService/
 * DouyinDmOutreachService/DeviceAccountScanService 的任务广播照常发得出去，只是没有任何
 * 服务在监听，agent 心跳仍报 online，采集/私信/账号扫描却静默全部失效。
 *
 * App 本身无法在不越权(WRITE_SECURE_SETTINGS 是系统权限，普通 App 拿不到)的情况下自动重新
 * 开启无障碍服务，能做的是让这个状态从"静默"变成"显式可观测"：本函数判定
 * `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 原始字符串里缺了哪些必需服务。
 */
class AgentServiceAccessibilityHealthTest {

    private val allThreeEnabled =
        "com.zenithjoy.agent/.collect.DouyinCollectService:" +
            "com.zenithjoy.agent/.collect.DouyinDmOutreachService:" +
            "com.zenithjoy.agent/.account.DeviceAccountScanService"

    private fun agentServiceSource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AgentService.kt not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    @Test
    fun `全部三个服务都在已启用列表——无缺失`() {
        val missing = AgentService.missingAccessibilityServices(allThreeEnabled, AgentService.REQUIRED_ACCESSIBILITY_SERVICES)
        assertTrue(missing.isEmpty())
    }

    @Test
    fun `force-stop 后系统整体关闭无障碍——settings 读到 null，全部三个都算缺失`() {
        val missing = AgentService.missingAccessibilityServices(null, AgentService.REQUIRED_ACCESSIBILITY_SERVICES)
        assertEquals(AgentService.REQUIRED_ACCESSIBILITY_SERVICES, missing)
    }

    @Test
    fun `只缺 dm_outreach 服务——只报这一个缺失，不误报其它两个`() {
        val onlyTwoEnabled =
            "com.zenithjoy.agent/.collect.DouyinCollectService:" +
                "com.zenithjoy.agent/.account.DeviceAccountScanService"
        val missing = AgentService.missingAccessibilityServices(onlyTwoEnabled, AgentService.REQUIRED_ACCESSIBILITY_SERVICES)
        assertEquals(listOf("com.zenithjoy.agent/.collect.DouyinDmOutreachService"), missing)
    }

    @Test
    fun `无关的其它无障碍服务混在列表里不影响判定`() {
        val withNoise = "com.other.app/.SomeService:$allThreeEnabled"
        val missing = AgentService.missingAccessibilityServices(withNoise, AgentService.REQUIRED_ACCESSIBILITY_SERVICES)
        assertTrue(missing.isEmpty())
    }

    @Test
    fun `注册重试抢先时也必须在构造请求前补齐机器身份`() {
        val source = agentServiceSource()
        val registerStart = source.indexOf("private suspend fun performRegister()")
        val registerEnd = source.indexOf("\n    private ", registerStart + 1).let {
            if (it == -1) source.length else it
        }
        val registerBody = source.substring(registerStart, registerEnd)

        val lockIndex = registerBody.indexOf("registerCallInFlight.compareAndSet(false, true)")
        val identityIndex = registerBody.indexOf("ensureRegistrationIdentity()")
        val requestIndex = registerBody.indexOf("AgentRegistrar.RegisterRequest(")

        assertTrue("performRegister must still own the single-flight lock", lockIndex >= 0)
        assertTrue(
            "the winning register call must initialize identity after it owns the lock",
            identityIndex > lockIndex,
        )
        assertTrue(
            "identity must be initialized before the HTTP register request is constructed",
            requestIndex > identityIndex,
        )
    }
}
