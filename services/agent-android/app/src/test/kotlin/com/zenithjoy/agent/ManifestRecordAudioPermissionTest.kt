package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * RECORD_AUDIO 权限声明守卫（回归）。
 *
 * 真机复现 2026-07-19：AudioRecordService.captureAudioSnippet() 里
 * AudioRecord.Builder().build() 在没有 RECORD_AUDIO 权限时抛 SecurityException，
 * 被 catch 吞掉返回 null，音频转写判定链路静默卡死——manifest 从未声明过这个权限。
 */
class ManifestRecordAudioPermissionTest {

    private fun readManifest(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found at ${candidates.map { it.path }}")
        return file.readText()
    }

    @Test
    fun `manifest必须声明RECORD_AUDIO权限`() {
        val manifest = readManifest()
        assertTrue(
            "AndroidManifest.xml 缺少 RECORD_AUDIO 权限声明，音频转写判定在真机会静默卡死",
            manifest.contains("android.permission.RECORD_AUDIO"),
        )
    }
}
