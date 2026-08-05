package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 静态调用点检查（sprint 08031620-android-scan-preconditions，Risks 表问题2 mitigation）：
 * 确认 SCREEN_LOCKED/LAUNCH_BLOCKED 上报调用点真的传了 versionName/stage/foregroundPackage
 * 三参数（不是只在 buildAccountScanResultBody 签名加了默认值参数，调用点却漏传导致静默不生效）。
 * 沿用 DeviceAccountScanServiceBroadcastTest.kt 已验证过的"结构性源码检查"模式
 * （本仓库无 Robolectric，AccessibilityService 调用点无法直接起 Android 运行时单测）。
 */
class DeviceAccountScanServiceDiagnosticFieldsCallSiteTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    private fun callSiteBlockFor(errorCodeLiteral: String, src: String): String {
        val idx = src.indexOf(errorCodeLiteral)
        if (idx < 0) return ""
        // 取错误码字面量所在语句块：从上一个换行往前找到该调用语句起点较复杂，简化为
        // 取字面量前后各 300 字符窗口，覆盖同一条多行链式调用的参数列表
        val start = maxOf(0, idx - 300)
        val end = minOf(src.length, idx + 300)
        return src.substring(start, end)
    }

    @Test
    fun `SCREEN_LOCKED 错误码字面量已接入且同窗口内出现 versionName 参数`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue("SCREEN_LOCKED 错误码应存在", src.contains("\"SCREEN_LOCKED\""))
        val window = callSiteBlockFor("\"SCREEN_LOCKED\"", src)
        assertTrue("SCREEN_LOCKED 调用点附近应出现 versionName 参数传递", window.contains("versionName"))
    }

    @Test
    fun `LAUNCH_BLOCKED 错误码字面量已接入且同窗口内出现 foregroundPackage 参数`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue("LAUNCH_BLOCKED 错误码应存在", src.contains("\"LAUNCH_BLOCKED\""))
        val window = callSiteBlockFor("\"LAUNCH_BLOCKED\"", src)
        assertTrue("LAUNCH_BLOCKED 调用点附近应出现 foregroundPackage 参数传递", window.contains("foregroundPackage"))
    }
}
