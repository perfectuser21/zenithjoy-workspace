package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * 真机排障 2026-07-17：AgentConfig.DEFAULT_WS_URL 写死指向 wss://api.zenithjoy.com/agent-ws，
 * 但这个域名从未有 DNS 记录（dig 无结果，curl 报 Could not resolve host）——生产真实地址是
 * wss://autopilot.zenjoymedia.media/agent-ws（对齐 mmv launchd plist 的 AGENT_PUBLIC_WS_URL）。
 * License 输入页的"API URL"输入框默认就填的这个常量（MainActivity.showLicenseInput()），
 * 员工手动输入 License Key 时如果不去改这个预填值，注册请求连服务器都连不上——这才是
 * 当天"未注册"且状态页显示"网络错误"的真正根因，跟 License 格式/配额完全无关。
 */
class DefaultWsUrlTest {

    @Test
    fun `DEFAULT_WS_URL 必须指向真实存在的生产域名 autopilot dot zenjoymedia dot media`() {
        assertEquals("wss://autopilot.zenjoymedia.media/agent-ws", AgentConfig.DEFAULT_WS_URL)
    }

    @Test
    fun `DEFAULT_WS_URL 不能再是从未有DNS记录的api dot zenithjoy dot com`() {
        assertNotEquals("wss://api.zenithjoy.com/agent-ws", AgentConfig.DEFAULT_WS_URL)
    }
}
