package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * AI on-call 刀2b 接线守卫（源码静态断言，同 AgentVersionReportingTest 做法）。
 *
 * 钉住：NO_SEARCH_INPUT 两个判死点（搜索入口 / 搜索输入框）在 finishWithOutcome 之前
 * 必须先问一次定位求助——这正是"每步 AI 保底"从协议变成现实的那根线。缺了它，
 * 刀2a 的端点就是没人拨的热线。
 */
class LocatorAssistWiringTest {

    private fun readSource(relativePaths: List<String>): String {
        val file = relativePaths.map { File(it) }.firstOrNull { it.exists() }
            ?: error("source file not found in $relativePaths")
        return file.readText()
    }

    private fun dmOutreachServiceSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt",
        )
    )

    @Test
    fun `失败判死前接了定位求助`() {
        val src = dmOutreachServiceSource()
        assertTrue(
            "DouyinDmOutreachService 未接 LocatorAssistClient——刀2a 的端点没人拨",
            src.contains("LocatorAssistClient"),
        )
        assertTrue(
            "缺 tryLocatorAssist 保底函数（求助→候选→使用→验证→回执的收口点）",
            src.contains("tryLocatorAssist"),
        )
    }

    @Test
    fun `搜索入口与搜索输入框两个判死点都挂了保底`() {
        val src = dmOutreachServiceSource()
        assertTrue("缺 dm_search_entry 步骤键", src.contains("\"dm_search_entry\""))
        assertTrue("缺 dm_search_input 步骤键", src.contains("\"dm_search_input\""))
    }

    @Test
    fun `候选使用后必须发 verified 回执——刀3 周报靠它判答案稳不稳`() {
        val src = dmOutreachServiceSource()
        assertTrue("缺 verified 回执调用", src.contains("reportAssistVerified"))
    }
}
