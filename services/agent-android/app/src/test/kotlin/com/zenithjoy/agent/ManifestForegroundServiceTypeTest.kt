package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：AgentService 曾声明 foregroundServiceType="connectedDevice"，但该 App 不持有
 * 蓝牙、USB 等相关权限——在 targetSdk 34（Android 14+）真机上，startForeground()
 * 必然抛 SecurityException 崩溃（真机验证时实测复现）。connectedDevice 类型要求的权限
 * 这个 App 根本不需要也不该申请，正确类型是 dataSync（周期性网络同步/心跳）。
 *
 * sprints/07122051-content-judgment-client-wiring 接续刀新增 mediaProjection 类型
 * （截图内容判定门槛，见 ScreenCaptureReal/MediaProjectionHolder），属性值变成
 * 管道分隔的多类型 "dataSync|mediaProjection"——断言改成按 "|" 拆分逐项校验，
 * 而不是要求属性值精确等于单一 "dataSync"。
 */
class ManifestForegroundServiceTypeTest {

    private fun manifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    /** 提取 AgentService 声明的 foregroundServiceType 属性值，按 "|" 拆分成类型列表。 */
    private fun agentServiceForegroundTypes(manifest: String): List<String> {
        val match = Regex("android:foregroundServiceType=\"([^\"]+)\"").find(manifest)
            ?: error("foregroundServiceType attribute not found in manifest")
        return match.groupValues[1].split("|")
    }

    @Test
    fun `AgentService foregroundServiceType is dataSync not connectedDevice`() {
        val types = agentServiceForegroundTypes(manifestText())
        assertFalse(
            "connectedDevice 类型需要蓝牙/USB 权限，本 App 不持有，会在 Android 14+ 崩溃",
            types.contains("connectedDevice"),
        )
        assertTrue(
            "AgentService 应声明 foregroundServiceType 含 dataSync",
            types.contains("dataSync"),
        )
    }

    @Test
    fun `manifest declares FOREGROUND_SERVICE_DATA_SYNC not CONNECTED_DEVICE permission`() {
        val manifest = manifestText()
        assertFalse(
            manifest.contains("android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE"),
        )
        assertTrue(
            manifest.contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC"),
        )
    }

    /**
     * sprints/07122051-content-judgment-client-wiring 接续刀新增：AgentService 必须同时声明
     * mediaProjection 类型（Android 14 要求），否则 ScreenCaptureReal 的真实截图调用链路
     * 在真机上会抛 MissingForegroundServiceTypeException/SecurityException。
     */
    @Test
    fun `AgentService foregroundServiceType includes mediaProjection`() {
        val types = agentServiceForegroundTypes(manifestText())
        assertTrue(
            "AgentService 应声明 foregroundServiceType 含 mediaProjection（截图内容判定门槛需要）",
            types.contains("mediaProjection"),
        )
    }

    @Test
    fun `manifest declares FOREGROUND_SERVICE_MEDIA_PROJECTION permission`() {
        val manifest = manifestText()
        assertTrue(
            manifest.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"),
        )
    }
}
