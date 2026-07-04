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

    @Test
    fun `AgentService foregroundServiceType is dataSync not connectedDevice`() {
        val manifest = manifestText()
        assertFalse(
            "connectedDevice 类型需要蓝牙/USB 权限，本 App 不持有，会在 Android 14+ 崩溃",
            manifest.contains("android:foregroundServiceType=\"connectedDevice\""),
        )
        assertTrue(
            "AgentService 应声明 foregroundServiceType=\"dataSync\"",
            manifest.contains("android:foregroundServiceType=\"dataSync\""),
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
}
