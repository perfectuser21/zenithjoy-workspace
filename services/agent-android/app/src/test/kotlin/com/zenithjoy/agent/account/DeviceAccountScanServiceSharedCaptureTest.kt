package com.zenithjoy.agent.account

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 静态检查：captureFailureDiagnostics 必须复用 AgentService 的共享 ScreenCaptureService 实例，
 * 不能自己 new 一个新的（否则会撞上 A14 CaptureSessionManager 单例纪律，重复 createVirtualDisplay
 * 崩溃，殃及 ContentJudgmentService 的截图能力）。final whole-branch review 发现的 Critical 问题。
 */
class DeviceAccountScanServiceSharedCaptureTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    @Test
    fun `captureFailureDiagnostics 使用共享的 AgentService_sharedScreenCaptureService，不自己new实例`() {
        val src = File(SOURCE_PATH).readText()
        val fnBody = src.substringAfter("private fun captureFailureDiagnostics").substringBefore("\n    }\n")
        assertTrue("应引用共享实例 AgentService.sharedScreenCaptureService", fnBody.contains("AgentService.sharedScreenCaptureService"))
        assertFalse("不应自己 new ScreenCaptureService(...)（会创建第二个 CaptureSessionManager，撞崩共享projection）", fnBody.contains("ScreenCaptureService("))
    }
}
