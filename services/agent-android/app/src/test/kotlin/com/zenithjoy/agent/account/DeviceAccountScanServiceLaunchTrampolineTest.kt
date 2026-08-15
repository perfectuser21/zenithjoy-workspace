package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1）的接线不能被静默拆掉。
 * 本 repo JVM 单测无法运行 AccessibilityService/Activity，只能锁源文本
 * （对齐 MainActivityRegisterErrorDisplayTest 的做法）：
 *  1) DeviceAccountScanService.launchDouyinApp() 必须经 DouyinLaunchTrampoline.buildTrampolineIntent 起 trampoline；
 *  2) 必须保留直启回退 launchDouyinDirect()（trampoline 起不来时行为 = 改动前）；
 *  3) trampoline Activity 必须在 onResume 拉起目标并 finish。
 */
class DeviceAccountScanServiceLaunchTrampolineTest {

    private fun source(relative: String): String {
        val file = listOf("src/main/kotlin/$relative", "app/src/main/kotlin/$relative")
            .map { File(it) }.firstOrNull { it.exists() } ?: error("$relative not found")
        return file.readText()
    }

    private fun functionBody(src: String, signature: String): String {
        val start = src.indexOf(signature).also { require(it >= 0) { "找不到 $signature" } }
        // 取到下一个顶层 "    private fun " / "    override fun " / "    fun " 之前
        val rest = src.substring(start + signature.length)
        val next = Regex("\\n    (private |internal |override )?(suspend )?fun ").find(rest)?.range?.first ?: rest.length
        return rest.substring(0, next)
    }

    @Test
    fun `launchDouyinApp 经 trampoline 拉起并保留直启回退`() {
        val svc = source("com/zenithjoy/agent/account/DeviceAccountScanService.kt")
        val body = functionBody(svc, "private fun launchDouyinApp()")
        assertTrue("launchDouyinApp 必须调用 DouyinLaunchTrampoline.buildTrampolineIntent", body.contains("DouyinLaunchTrampoline.buildTrampolineIntent"))
        assertTrue("launchDouyinApp 必须在异常时回退 launchDouyinDirect()", body.contains("launchDouyinDirect()"))
        val direct = functionBody(svc, "private fun launchDouyinDirect()")
        assertTrue("launchDouyinDirect 必须保留原 getLaunchIntentForPackage 直启", direct.contains("getLaunchIntentForPackage(DOUYIN_PKG)"))
    }

    @Test
    fun `trampoline activity 在 onResume 拉起目标并 finish`() {
        val act = source("com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt")
        assertTrue(act.contains("override fun onResume()"))
        assertTrue(act.contains("getLaunchIntentForPackage("))
        assertTrue(act.contains("DouyinLaunchTrampoline.TARGET_FLAGS"))
        assertTrue(act.contains("finish()"))
    }
}
