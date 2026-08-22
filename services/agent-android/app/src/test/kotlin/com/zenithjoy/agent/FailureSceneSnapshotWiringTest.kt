package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * AI on-call 横切件 · 刀1 接线守卫（源码静态断言，同 AgentVersionReportingTest 做法：
 * 本机无 Android SDK 无法跑完整编译单测，CI 的 JVM 单测能跑）。
 *
 * 钉住三处接线，缺任何一处，树快照/设备版本就只存在于某一层、落不进正表：
 *   1. DouyinDmOutreachService 失败时采树快照并随广播带出（EXTRA_UI_TREE）
 *   2. AgentService 上报 body 携带 ui_tree_snapshot + 设备版本三件
 *      （device_model/os_version/app_version——机队版本随时间漂移，按行落库才能事后
 *      按机型×版本聚类，这正是周报固化的分组键）
 *   3. 设备版本来自 Build/BuildConfig 真实值，不许写死字符串（同 2.0.0-android 教训）
 */
class FailureSceneSnapshotWiringTest {

    private fun readSource(relativePaths: List<String>): String {
        val file = relativePaths.map { File(it) }.firstOrNull { it.exists() }
            ?: error("source file not found in $relativePaths")
        return file.readText()
    }

    private fun agentServiceSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/AgentService.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt",
        )
    )

    private fun dmOutreachServiceSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt",
        )
    )

    @Test
    fun `DouyinDmOutreachService 失败时采树快照并随结果广播带出`() {
        val src = dmOutreachServiceSource()
        assertTrue("缺 EXTRA_UI_TREE 广播 extra——快照采了也带不出无障碍服务进程", src.contains("EXTRA_UI_TREE"))
        assertTrue("finishWithOutcome 未接 UiTreeSnapshot——失败那一刻的树没被采集", src.contains("UiTreeSnapshot"))
    }

    @Test
    fun `AgentService 上报 body 携带树快照字段`() {
        assertTrue(
            "reportDmOutreachResult body 缺 ui_tree_snapshot——广播带到了 AgentService 却没上报中台",
            agentServiceSource().contains("\"ui_tree_snapshot\""),
        )
    }

    @Test
    fun `AgentService 上报 body 携带设备版本三件套`() {
        val src = agentServiceSource()
        for (field in listOf("\"device_model\"", "\"os_version\"", "\"app_version\"")) {
            assertTrue("reportDmOutreachResult body 缺 $field——周报没法按机型×版本聚类", src.contains(field))
        }
    }

    @Test
    fun `设备版本来自 Build-BuildConfig 真实值而非写死字符串`() {
        val src = agentServiceSource()
        assertTrue("device_model 应来自 Build.MODEL", src.contains("Build.MODEL"))
        assertTrue("os_version 应来自 Build.VERSION.RELEASE", src.contains("Build.VERSION.RELEASE"))
        assertTrue("app_version 应来自 BuildConfig.VERSION_NAME", src.contains("BuildConfig.VERSION_NAME"))
    }
}
