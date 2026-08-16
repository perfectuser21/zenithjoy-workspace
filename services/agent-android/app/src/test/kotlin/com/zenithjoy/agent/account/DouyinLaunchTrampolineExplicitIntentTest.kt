package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：trampoline 支持"显式目标 Intent"（Brain task ebbef956）。
 *
 * 背景：真机证实 DouyinCollectService（采集）/ DouyinDmOutreachService（私信）从后台拉抖音
 * 同样被荣耀 iAware 拦截（logcat `prevent start activity by iaware`）。这两处的目标 Intent
 * 各自带自己的语义 flags（CLEAR_TASK / 深链 ACTION_VIEW），不能像 DeviceAccountScanService
 * 那样只传包名再由 trampoline 重新 getLaunchIntentForPackage——那样会丢失调用方的 flags。
 * 所以 trampoline 需要一条新路径：调用方把已经构造好 flags 的目标 Intent 整个塞进
 * trampoline Intent 的 extra，trampoline Activity 只负责"先当前台 Activity 再原样转发"。
 *
 * 本 repo JVM 单测不能构造 android.content.Intent/跑 Activity，源文本断言对齐
 * DeviceAccountScanServiceLaunchTrampolineTest 的 functionBody 写法。
 */
class DouyinLaunchTrampolineExplicitIntentTest {

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

    @Test
    fun `EXTRA_TARGET_INTENT 常量值固定`() {
        assertEquals(
            "com.zenithjoy.agent.extra.LAUNCH_TARGET_INTENT",
            DouyinLaunchTrampoline.EXTRA_TARGET_INTENT,
        )
    }

    @Test
    fun `buildTrampolineIntentForTarget 把显式目标 Intent 塞进 extra 并挂 TRAMPOLINE_FLAGS`() {
        val src = source("com/zenithjoy/agent/account/DouyinLaunchTrampoline.kt")
        val body = functionBody(src, "fun buildTrampolineIntentForTarget(context: Context, targetIntent: Intent): Intent")
        assertTrue(
            "buildTrampolineIntentForTarget 必须 putExtra(EXTRA_TARGET_INTENT, targetIntent)",
            body.contains("putExtra(EXTRA_TARGET_INTENT, targetIntent)"),
        )
        assertTrue(
            "buildTrampolineIntentForTarget 必须 addFlags(TRAMPOLINE_FLAGS)",
            body.contains("addFlags(TRAMPOLINE_FLAGS)"),
        )
    }

    @Test
    fun `launchTargetThenFinish 优先转发显式目标 Intent，否则回退按包名路径，两条路径都 finish`() {
        val act = source("com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt")
        val body = functionBody(act, "private fun launchTargetThenFinish()")
        assertTrue(
            "launchTargetThenFinish 必须先读 EXTRA_TARGET_INTENT",
            body.contains("EXTRA_TARGET_INTENT"),
        )
        assertTrue(
            "launchTargetThenFinish 必须用 getParcelableExtra 读显式目标 Intent",
            body.contains("getParcelableExtra"),
        )
        assertTrue(
            "非空时必须 startActivity 显式目标 Intent",
            body.contains("startActivity("),
        )
        assertTrue(
            "必须仍保留按包名路径（getLaunchIntentForPackage）",
            body.contains("getLaunchIntentForPackage("),
        )
        val finishCount = Regex("finish\\(\\)").findAll(body).count()
        assertTrue(
            "两条路径（显式转发 / 按包名回退）都必须 finish() 自身，至少出现 2 次",
            finishCount >= 2,
        )
    }
}
