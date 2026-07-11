package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：AGENT_VERSION 曾是写死字符串 "2.0.0-android"，与 build.gradle.kts 里真实的
 * versionName（2.1.1，真机确认过的实际安装版本是 2.1.7）完全脱节。AgentRegistrar 上报
 * 给服务器的 version 字段永远显示旧值，排障时会误判客户端真实版本（0711 真机调试踩过）。
 * 本机无 Android SDK 无法跑完整编译单测，走源码静态断言（同 NetworkSecurityConfigTest 的
 * 做法），CI 里的 JVM 单测能跑。
 */
class AgentVersionReportingTest {

    private fun readSource(relativePaths: List<String>): String {
        val file = relativePaths.map { File(it) }.firstOrNull { it.exists() }
            ?: error("source file not found in $relativePaths")
        return file.readText()
    }

    private fun agentConfigSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/AgentConfig.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/AgentConfig.kt",
        )
    )

    private fun agentRegistrarSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/AgentRegistrar.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/AgentRegistrar.kt",
        )
    )

    private fun buildGradleSource() = readSource(
        listOf(
            "build.gradle.kts",
            "app/build.gradle.kts",
        )
    )

    @Test
    fun `AgentConfig no longer hardcodes a fake version string`() {
        assertFalse(
            "AgentConfig 不该再写死版本号字符串，应改读 BuildConfig.VERSION_NAME",
            agentConfigSource().contains("\"2.0.0-android\""),
        )
    }

    @Test
    fun `AgentRegistrar reports BuildConfig VERSION_NAME not a stale constant`() {
        assertTrue(
            "AgentRegistrar 上报的 version 字段必须来自 BuildConfig.VERSION_NAME",
            agentRegistrarSource().contains("BuildConfig.VERSION_NAME"),
        )
    }

    @Test
    fun `build gradle enables BuildConfig generation`() {
        assertTrue(
            "需要 buildFeatures.buildConfig = true 才能生成 BuildConfig.VERSION_NAME",
            buildGradleSource().contains("buildConfig = true"),
        )
    }
}
