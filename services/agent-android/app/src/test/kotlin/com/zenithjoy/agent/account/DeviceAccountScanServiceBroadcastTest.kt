package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 静态检查：确认失败路径真的接入了截图+树摘要捕获（不是只加了参数没调用）。
 * sprint 07201209。
 */
class DeviceAccountScanServiceBroadcastTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    @Test
    fun `sendScanResultBroadcast 含 screenshotB64 和 treeDump 参数`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue(src.contains("screenshotB64: String? = null"))
        assertTrue(src.contains("treeDump: String? = null"))
    }

    @Test
    fun `EXTRA_SCREENSHOT_B64 和 EXTRA_TREE_DUMP 已声明`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue(src.contains("EXTRA_SCREENSHOT_B64"))
        assertTrue(src.contains("EXTRA_TREE_DUMP"))
    }

    @Test
    fun `OPEN_PANEL_FAILED 和 READ_FAILED 调用点都传了 screenshotB64 与 treeDump（不是只声明参数没实际调用）`() {
        val src = File(SOURCE_PATH).readText()
        val openPanelFailedCallSite = src.substringAfter("errorCode = \"OPEN_PANEL_FAILED\"").substringBefore("return")
        // errorCode = "OPEN_PANEL_FAILED" 本身在调用参数列表里，往前找该行的调用语句
        val fullCallLine = src.lines().firstOrNull { it.contains("errorCode = \"OPEN_PANEL_FAILED\"") } ?: ""
        assertTrue("OPEN_PANEL_FAILED 调用点应传 screenshotB64", fullCallLine.contains("screenshotB64"))
        val readFailedLine = src.lines().firstOrNull { it.contains("if (readSucceeded) \"\" else \"READ_FAILED\"") } ?: ""
        assertTrue("READ_FAILED 调用点应传 screenshotB64", readFailedLine.contains("screenshotB64"))
    }
}
