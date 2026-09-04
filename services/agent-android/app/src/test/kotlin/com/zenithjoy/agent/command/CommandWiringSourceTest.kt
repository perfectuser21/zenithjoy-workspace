package com.zenithjoy.agent.command

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 接线断言（源码文本级，先例 DeviceAccountScanServiceSharedCaptureTest）。 */
class CommandWiringSourceTest {
    private fun src(path: String) = File("src/main/kotlin/com/zenithjoy/agent/$path").readText()

    @Test fun `AgentService 注册了 cmd 路由`() {
        val s = src("AgentService.kt")
        assertTrue("AgentService 必须路由 cmd 消息到 CommandQueue", s.contains("\"cmd\"") && s.contains("routeCommand"))
    }

    @Test fun `heartbeat busy 不再写死 false`() {
        val s = src("WsClient.kt")
        assertFalse("busy 必须走 busyProbe", s.contains("\"busy\" to false"))
        assertTrue(s.contains("busyProbe"))
    }

    @Test fun `WsClient 不再打印含 token 的完整 wsUrl`() {
        val s = src("WsClient.kt")
        assertFalse("token 泄漏日志必须移除（logcat 可读=整机可被冒充遥控）", s.contains("connecting to \$wsUrl"))
    }

    @Test fun `busyProbe 接了租约与 ScanMutex`() {
        val s = src("AgentService.kt")
        assertTrue(s.contains("AutomationLease.currentOwner()") && s.contains("ScanMutex.busy"))
    }

    @Test fun `tree_dump 回执带 nodeCount`() {
        val s = src("AgentService.kt")
        assertTrue(
            "PrepPRD 指令表：tree_dump 回执必须带 truncated 标志+节点数",
            s.contains("\"nodeCount\""),
        )
    }

    @Test fun `远程协助开关存在且默认开`() {
        val s = src("AgentConfig.kt")
        assertTrue(s.contains("remoteControlEnabled"))
        assertTrue("Alex 2026-09-04 拍板默认开", s.contains("getBoolean(KEY_REMOTE_CONTROL_ENABLED, true)"))
    }
}
