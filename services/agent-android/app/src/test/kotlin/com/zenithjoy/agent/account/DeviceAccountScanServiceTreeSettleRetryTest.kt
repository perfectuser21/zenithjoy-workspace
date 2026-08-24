package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(0824，HONOR ANY-AN00)：scan_me_tab 的 AI on-call 连续6次选错
 * (view_id分别为1u_/zuu/0ll/desc/gla/e6e)。确诊根因——`tryLocatorAssist` 只抓
 * 一次树快照就直接发给AI，抓拍时机可能撞上底部导航所在子树还没渲染稳定的过渡
 * 帧：对比两次独立失败快照，同一容器 id=w5w 的 bounds 分别是
 * `[0,0][1080,2149]` 和 `[0,0][1080,0]`——同一 view 在不同抓取瞬间 bounds
 * 天差地别，实锤渲染还没稳定。主查找路径(awaitNode)对这类情况已有轮询防护，
 * 但 tryLocatorAssist 自己的树抓取没有同款重试。本仓库测试环境无
 * Mockito/Robolectric，照抄既有源码锚点静态检查写法。
 */
class DeviceAccountScanServiceTreeSettleRetryTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    private fun treeCaptureBlock(src: String): String =
        src.substringAfter(
            "private suspend fun tryLocatorAssist(step: String, targetDesc: String, errorCode: String): LocatorAssistOutcome? {",
            missingDelimiterValue = "",
        ).substringBefore("val httpBase = AgentConfig", missingDelimiterValue = "")

    @Test
    fun `树抓取必须重试多次挑最完整快照，不能只抓一次就用`() {
        val src = File(SOURCE_PATH).readText()
        val block = treeCaptureBlock(src)
        assertTrue("tryLocatorAssist 树抓取锚点必须存在", block.isNotEmpty())
        assertTrue(
            "必须有重试循环结构(repeat/for)在抓树，不能只调用一次" +
                "UiTreeSnapshot.serialize 就直接当结果用——真机证据(同一容器id=w5w" +
                "在两次抓取里bounds分别是[0,0][1080,2149]和[0,0][1080,0])证明单次" +
                "抓拍可能撞上渲染未稳定的过渡帧",
            block.contains("repeat(") || block.contains("for ("),
        )
        assertTrue(
            "抓多次后必须比较挑出更完整的那次(如按序列化长度比大小)，" +
                "不能抓了多次却还是只用第一次的结果",
            block.contains(".length"),
        )
        assertTrue(
            "重试之间必须有 delay 等待，不能背靠背连续抓同一个未刷新的帧",
            block.contains("delay("),
        )
    }
}
