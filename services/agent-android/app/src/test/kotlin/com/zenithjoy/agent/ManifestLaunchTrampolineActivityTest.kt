package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1）依赖一个透明 trampoline Activity。
 * 若它从 Manifest 消失或属性被改坏（进最近任务/留返回栈/带 UI/被导出），客户手机上会出现
 * 残留窗口或安全面暴露——本测试锁定声明形态，对齐既有 ShareIngestActivity 模式。
 */
class ManifestLaunchTrampolineActivityTest {

    private fun manifestText(): String {
        val file = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        ).firstOrNull { it.exists() } ?: error("AndroidManifest.xml not found")
        return file.readText()
    }

    /** 提取 trampoline activity 的整段声明（自闭合或带子节点均可）。 */
    private fun trampolineDeclaration(manifest: String): String {
        val regex = Regex(
            "<activity[^>]*android:name=\"\\.account\\.DouyinLaunchTrampolineActivity\"[^>]*?(/>|>)",
            RegexOption.DOT_MATCHES_ALL,
        )
        return regex.find(manifest)?.value
            ?: error("Manifest 未声明 .account.DouyinLaunchTrampolineActivity")
    }

    private fun attr(decl: String, name: String): String? =
        Regex("android:$name=\"([^\"]*)\"").find(decl)?.groupValues?.get(1)

    @Test
    fun `trampoline activity 已声明且不导出`() {
        val decl = trampolineDeclaration(manifestText())
        assertEquals("false", attr(decl, "exported"))
    }

    @Test
    fun `trampoline activity 不进最近任务、不留返回栈、独立 task、透明主题`() {
        val decl = trampolineDeclaration(manifestText())
        assertEquals("true", attr(decl, "excludeFromRecents"))
        assertEquals("true", attr(decl, "noHistory"))
        assertEquals("", attr(decl, "taskAffinity"))
        assertEquals("singleTask", attr(decl, "launchMode"))
        assertTrue(
            "theme 必须是透明主题",
            (attr(decl, "theme") ?: "").contains("Translucent"),
        )
    }
}
