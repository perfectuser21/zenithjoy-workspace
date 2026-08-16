package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：AgentService 里 AcquisitionCollectPollLoop 的 videoOpener 回调（判决门截图前用深链
 * 打开目标视频）同样从后台 Service 直接 startActivity 拉抖音，与 DouyinCollectService/
 * DouyinDmOutreachService/DeviceAccountScanService 同一类问题（荣耀 iAware 拦截），
 * 改走 trampoline（Brain task ebbef956）。
 *
 * 本 repo JVM 单测不能构造 android.content.Intent/跑 Service，源文本断言对齐
 * DeviceAccountScanServiceLaunchTrampolineTest 的写法。
 */
class AgentServiceVideoOpenerTrampolineTest {

    private fun source(relative: String): String {
        val file = listOf("src/main/kotlin/$relative", "app/src/main/kotlin/$relative")
            .map { File(it) }.firstOrNull { it.exists() } ?: error("$relative not found")
        return file.readText()
    }

    private fun videoOpenerBlock(src: String): String {
        val start = src.indexOf("videoOpener = {").also { require(it >= 0) { "找不到 videoOpener = {" } }
        val end = src.indexOf("onStage1Task = {", start).also { require(it >= 0) { "找不到 videoOpener 之后的 onStage1Task = {" } }
        return src.substring(start, end)
    }

    @Test
    fun `videoOpener 深链先经 trampoline 转发并保留直启回退`() {
        val src = source("com/zenithjoy/agent/AgentService.kt")
        val block = videoOpenerBlock(src)
        assertTrue(
            "videoOpener 必须构造 snssdk1128 深链",
            block.contains("snssdk1128://aweme/detail/"),
        )
        assertTrue(
            "videoOpener 必须调用 DouyinLaunchTrampoline.buildTrampolineIntentForTarget",
            block.contains("DouyinLaunchTrampoline.buildTrampolineIntentForTarget("),
        )
        assertTrue(
            "videoOpener 必须保留 applicationContext.startActivity(intent) 直启回退",
            block.contains("applicationContext.startActivity(intent)"),
        )
    }
}
