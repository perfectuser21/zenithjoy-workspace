package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 回归测试：WS 重连 URL 必须携带 machine_id，否则服务端 hex ws_token
 * 校验永远走不通（2026-07-27 Path2 安卓智能获客验收 401 死循环）。
 */
class WsUrlBuilderTest {

    @Test
    fun `重连 URL 必须同时携带 token 与 machine_id`() {
        val url = WsUrlBuilder.build(
            apiUrl = "wss://staging-autopilot.zenjoymedia.media/agent-ws",
            token = "220d55af0011223344556677889900aabbccddeeff00112233445566778899", // gitleaks:allow (测试 fixture，非真 secret)
            machineId = "afa73fead5fd2b3be1fa6a5c1a66943e",
        )
        assertTrue(url.contains("token=220d55af0011223344556677889900aabbccddeeff00112233445566778899")) // gitleaks:allow
        assertTrue(url.contains("machine_id=afa73fead5fd2b3be1fa6a5c1a66943e"))
    }

    @Test
    fun `token 与 machine_id 都做 URL 编码`() {
        val url = WsUrlBuilder.build(
            apiUrl = "wss://staging-autopilot.zenjoymedia.media/agent-ws",
            token = "ZJ-F-ABCD 1234", // 含空格，验证编码
            machineId = "m/1",
        )
        assertEquals(
            "wss://staging-autopilot.zenjoymedia.media/agent-ws?token=ZJ-F-ABCD+1234&machine_id=m%2F1",
            url,
        )
    }
}
