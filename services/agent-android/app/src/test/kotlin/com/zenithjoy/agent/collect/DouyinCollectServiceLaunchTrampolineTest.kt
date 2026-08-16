package com.zenithjoy.agent.collect

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：DouyinCollectService 拉抖音的两处（launchDouyin/launchVideoByDeepLink）改走
 * trampoline（Brain task ebbef956）。真机证实 DouyinCollectService 从后台拉抖音同样被
 * 荣耀 iAware 拦截（logcat `prevent start activity by iaware`，result 102 →
 * NO_SEARCH_INPUT/KEYWORD_NO_RESULT），与 PR#1637 修的 DeviceAccountScanService 同一类问题。
 *
 * 本 repo JVM 单测不能构造 android.content.Intent/跑 Activity，源文本断言对齐
 * DeviceAccountScanServiceLaunchTrampolineTest 的 functionBody 写法。
 */
class DouyinCollectServiceLaunchTrampolineTest {

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

    private fun collectServiceSource() = source("com/zenithjoy/agent/collect/DouyinCollectService.kt")

    @Test
    fun `launchDouyin 经 trampoline 转发显式目标 Intent 并保留原 flags 与直启回退`() {
        val src = collectServiceSource()
        val body = functionBody(src, "private fun launchDouyin(): Boolean")
        assertTrue(
            "launchDouyin 必须调用 DouyinLaunchTrampoline.buildTrampolineIntentForTarget",
            body.contains("DouyinLaunchTrampoline.buildTrampolineIntentForTarget("),
        )
        assertTrue(
            "launchDouyin 必须仍然叠加 stage1LaunchFlags（CLEAR_TASK 语义不能丢）",
            body.contains("stage1LaunchFlags("),
        )
        assertTrue(
            "launchDouyin 必须在异常时回退 launchDouyinDirect()",
            body.contains("launchDouyinDirect()"),
        )
        val direct = functionBody(src, "private fun launchDouyinDirect(): Boolean")
        assertTrue(
            "launchDouyinDirect 必须保留原 getLaunchIntentForPackage 直启",
            direct.contains("getLaunchIntentForPackage(DOUYIN_PKG)"),
        )
        assertTrue(
            "launchDouyinDirect 必须保留原 stage1LaunchFlags",
            direct.contains("stage1LaunchFlags("),
        )
    }

    @Test
    fun `launchVideoByDeepLink 经 trampoline 转发深链 Intent 并保留直接回退`() {
        val src = collectServiceSource()
        val body = functionBody(src, "private fun launchVideoByDeepLink(videoId: String): Boolean")
        assertTrue(
            "launchVideoByDeepLink 必须构造 snssdk1128 深链",
            body.contains("snssdk1128://aweme/detail/"),
        )
        assertTrue(
            "launchVideoByDeepLink 必须调用 DouyinLaunchTrampoline.buildTrampolineIntentForTarget",
            body.contains("DouyinLaunchTrampoline.buildTrampolineIntentForTarget("),
        )
        assertTrue(
            "launchVideoByDeepLink 必须在异常时回退直接 startActivity",
            body.contains("applicationContext.startActivity(intent)"),
        )
    }
}
