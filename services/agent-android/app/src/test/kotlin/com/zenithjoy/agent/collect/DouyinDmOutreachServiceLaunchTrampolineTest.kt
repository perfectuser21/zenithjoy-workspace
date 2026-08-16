package com.zenithjoy.agent.collect

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：DouyinDmOutreachService.launchDouyinApp() 改走 trampoline（Brain task ebbef956）。
 * 真机证实私信服务从后台拉抖音同样被荣耀 iAware 拦截，与 PR#1637 修的
 * DeviceAccountScanService、以及 DouyinCollectService 同一类问题、同一模式修复。
 *
 * 本 repo JVM 单测不能构造 android.content.Intent/跑 Activity，源文本断言对齐
 * DeviceAccountScanServiceLaunchTrampolineTest 的 functionBody 写法。
 */
class DouyinDmOutreachServiceLaunchTrampolineTest {

    private fun source(relative: String): String {
        val file = listOf("src/main/kotlin/$relative", "app/src/main/kotlin/$relative")
            .map { File(it) }.firstOrNull { it.exists() } ?: error("$relative not found")
        return file.readText()
    }

    private fun functionBody(src: String, signature: String): String {
        val start = src.indexOf(signature).also { require(it >= 0) { "找不到 $signature" } }
        val rest = src.substring(start + signature.length)
        val next = Regex("\\n    (private |internal |override )?(suspend )?fun ").find(rest)?.range?.first ?: rest.length
        return rest.substring(0, next)
    }

    private fun dmOutreachServiceSource() = source("com/zenithjoy/agent/collect/DouyinDmOutreachService.kt")

    @Test
    fun `launchDouyinApp 经 trampoline 转发显式目标 Intent 并保留原 flags 与直启回退`() {
        val src = dmOutreachServiceSource()
        val body = functionBody(src, "private fun launchDouyinApp(): Boolean")
        assertTrue(
            "launchDouyinApp 必须调用 DouyinLaunchTrampoline.buildTrampolineIntentForTarget",
            body.contains("DouyinLaunchTrampoline.buildTrampolineIntentForTarget("),
        )
        assertTrue(
            "launchDouyinApp 必须仍然叠加 dmOutreachLaunchFlags（CLEAR_TASK 语义不能丢）",
            body.contains("dmOutreachLaunchFlags("),
        )
        assertTrue(
            "launchDouyinApp 必须在异常时回退 launchDouyinDirect()",
            body.contains("launchDouyinDirect()"),
        )
        val direct = functionBody(src, "private fun launchDouyinDirect(): Boolean")
        assertTrue(
            "launchDouyinDirect 必须保留原 getLaunchIntentForPackage 直启",
            direct.contains("getLaunchIntentForPackage(DOUYIN_PKG)"),
        )
        assertTrue(
            "launchDouyinDirect 必须保留原 dmOutreachLaunchFlags",
            direct.contains("dmOutreachLaunchFlags("),
        )
    }
}
