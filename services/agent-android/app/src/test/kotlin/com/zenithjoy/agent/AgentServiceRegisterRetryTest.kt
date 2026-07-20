package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
}
