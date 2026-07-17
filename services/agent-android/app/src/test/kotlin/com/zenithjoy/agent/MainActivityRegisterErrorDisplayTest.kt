package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：MainActivity 状态页曾经只显示"未注册"三个字，普通用户/员工没有 adb 权限
 * 完全看不出注册失败的具体原因（真机排障 2026-07-17）。本机 MainActivity 依赖
 * android.app.Activity 无法在纯 JVM 单测里实例化，走源码静态断言（同
 * AgentVersionReportingTest/NetworkSecurityConfigTest 的做法）。
 */
class MainActivityRegisterErrorDisplayTest {

    private fun mainActivitySource(): String {
        val file = listOf(
            "src/main/kotlin/com/zenithjoy/agent/MainActivity.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt",
        ).map { File(it) }.firstOrNull { it.exists() } ?: error("MainActivity.kt not found")
        return file.readText()
    }

    @Test
    fun `状态页把 lastRegisterError 展示出来`() {
        assertTrue(
            "未注册状态旁必须展示 config.lastRegisterError，否则用户没法自助排查",
            mainActivitySource().contains("config.lastRegisterError"),
        )
    }

    @Test
    fun `启动按钮先做客户端格式校验再触发网络注册`() {
        assertTrue(
            "应先用 AgentConfig.isValidLicenseKeyFormat 校验格式，格式错误的 key 不该绕一圈网络才报错",
            mainActivitySource().contains("AgentConfig.isValidLicenseKeyFormat"),
        )
    }

    @Test
    fun `License输入框提示不再是与后端格式不符的旧文案`() {
        assertFalse(
            "旧提示 \"License Key (ZJ-XXXX)\" 跟后端真实要求的 ZJ-X-XXXXXXXX 格式不符，会误导用户输入非法格式",
            mainActivitySource().contains("License Key (ZJ-XXXX)"),
        )
    }
}
