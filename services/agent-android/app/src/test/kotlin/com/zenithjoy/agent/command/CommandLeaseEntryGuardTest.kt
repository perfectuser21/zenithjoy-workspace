package com.zenithjoy.agent.command

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫（proven-to-fire）：远程指令会话持租约期间，三个无障碍服务的全部任务入口必须拒单。
 * 对抗审查 P0：现有服务只查各自 state 从不消费全局锁——没有这层守卫，
 * 「一机一自动化互斥」在入口处直接被绕过。
 */
class CommandLeaseEntryGuardTest {
    private fun src(path: String) = File("src/main/kotlin/com/zenithjoy/agent/$path").readText()

    private fun assertGuardBefore(source: String, funcName: String, file: String) {
        val funcStart = source.indexOf("fun $funcName(")
        assertTrue("$file 缺少函数 $funcName", funcStart >= 0)
        val window = source.substring(funcStart, minOf(source.length, funcStart + 800))
        assertTrue(
            "$file 的 $funcName 入口必须先问 AutomationLease.isHeldByOther 再动状态",
            window.contains("AutomationLease.isHeldByOther"),
        )
    }

    @Test fun `DouyinCollectService 两个入口有守卫`() {
        val s = src("collect/DouyinCollectService.kt")
        assertGuardBefore(s, "startCollect", "DouyinCollectService")
        assertGuardBefore(s, "startStage2Collect", "DouyinCollectService")
    }

    @Test fun `DouyinDmOutreachService 入口有守卫`() {
        assertGuardBefore(src("collect/DouyinDmOutreachService.kt"), "startOutreach", "DouyinDmOutreachService")
    }

    @Test fun `DeviceAccountScanService 两入口加内部检查点有守卫`() {
        val s = src("account/DeviceAccountScanService.kt")
        assertGuardBefore(s, "startScan", "DeviceAccountScanService")
        assertGuardBefore(s, "startWarmup", "DeviceAccountScanService")
        assertGuardBefore(s, "shouldRunScan", "DeviceAccountScanService")
    }
}
