package com.zenithjoy.agent.debug

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：DEBUG_E2E 触发器只能存在于 debug 变体。
 * - debug 源集 manifest 必须声明该 receiver exported=true + DEBUG_E2E action（否则 adb 广播投不进）。
 * - main 源集 manifest 绝不能含该 receiver（否则会合并进 release 包，暴露外部可伪造的任务入口）。
 */
class DebugManifestTest {

    private fun textOf(vararg candidates: String): String {
        val file = candidates.map { File(it) }.firstOrNull { it.exists() }
            ?: error("manifest not found in ${candidates.toList()}")
        return file.readText()
    }

    @Test
    fun `debug manifest declares exported DebugE2ETriggerReceiver with DEBUG_E2E action`() {
        val manifest = textOf("src/debug/AndroidManifest.xml", "app/src/debug/AndroidManifest.xml")
        assertTrue(
            "debug manifest 必须声明 DebugE2ETriggerReceiver",
            manifest.contains("DebugE2ETriggerReceiver"),
        )
        assertTrue(
            "该 receiver 必须 exported=true 才能被 adb 广播触发",
            manifest.contains("android:exported=\"true\""),
        )
        assertTrue(
            "必须注册 DEBUG_E2E action",
            manifest.contains("com.zenithjoy.agent.DEBUG_E2E"),
        )
    }

    @Test
    fun `main manifest does not contain the debug trigger receiver`() {
        val manifest = textOf("src/main/AndroidManifest.xml", "app/src/main/AndroidManifest.xml")
        assertFalse(
            "debug 触发器绝不能出现在 main manifest（会污染 release 包）",
            manifest.contains("DebugE2ETriggerReceiver"),
        )
        assertFalse(
            "DEBUG_E2E action 绝不能出现在 main manifest",
            manifest.contains("com.zenithjoy.agent.DEBUG_E2E"),
        )
    }
}
