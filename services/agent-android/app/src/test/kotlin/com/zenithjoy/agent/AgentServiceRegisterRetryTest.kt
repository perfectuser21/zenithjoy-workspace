package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.io.File
import org.junit.Test

/**
 * 真机复现(2026-07-20)：AgentService.agentInitialized 一次性标志位把 register() 锁死在
 * Service 首次 onStartCommand 里——staging License 配额修好后，用户点"重启 Agent 服务"
 * 按钮，10 分钟内服务器 /api/agent/register 与 ws hello 日志零新请求，证明按钮点击完全
 * 没有触发任何重试。shouldRetryRegister 是独立于 shouldRunInitAgent 的重试决策：只要还
 * 没注册成功、且没有另一次重试正在进行，就应该重试。
 */
class AgentServiceRegisterRetryTest {

    @Test
    fun `not registered and no retry in flight should retry`() {
        assertTrue(
            AgentService.shouldRetryRegister(isRegistered = false, retryInFlight = false)
        )
    }

    @Test
    fun `already registered should not retry`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = true, retryInFlight = false)
        )
    }

    @Test
    fun `retry already in flight should not start another`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = false, retryInFlight = true)
        )
    }

    @Test
    fun `already registered and retry in flight should not retry`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = true, retryInFlight = true)
        )
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

    private fun agentServiceSource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AgentService.kt not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }
}
