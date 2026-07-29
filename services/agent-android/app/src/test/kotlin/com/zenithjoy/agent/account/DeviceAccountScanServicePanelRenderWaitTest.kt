package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-29，客户已交付环境MAA-AN00，装含前3次修复的2.1.17真实跑通)：完整logcat证实
 * 前3次修复(我tab点击等待轮询PR#1523/厂商弹窗手势点击PR#1536/CLEAR_TOP恢复主页feed PR#1547)
 * 全部生效——"我tab命中无障碍树节点，点节点中心"→成功找到并点击"切换账号"入口，但点击后
 * "点了切换账号但面板未出现"，3次重试全部卡在这一步。
 *
 * 根因：点击"切换账号"后原实现只 delay(800L) 一次，然后调用 awaitRootInActiveWindow(attempts=6)——
 * 但这个函数语义是"等待任意非null根节点出现"就立即返回，不会等待 recycler_view 这个特定元素
 * 真正渲染完成，面板展开动画/加载较慢时检查过早，误判"面板未出现"。这与已验证两次有效的
 * 根因(我tab等待/CLEAR_TOP恢复)完全同源：固定短延迟单次检查，不是轮询等待目标元素出现。
 *
 * 修法：对齐已验证两次有效的轮询等待模式。
 *
 * 本仓库测试环境无 Mockito/Robolectric，照抄既有的源码静态检查写法。
 */
class DeviceAccountScanServicePanelRenderWaitTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住"点击切换账号后等待面板出现"这一段（PR#1554起轮询逻辑被提取成
    // awaitSwitchAccountPanel()辅助函数，供误触发重试路径复用，这里只验证调用点）
    private fun waitSegment(src: String): String =
        src.substringAfter("tapNodeCenter(switchEntry)", missingDelimiterValue = "")
            .substringBefore("if (panel != null) {\n                    return true", missingDelimiterValue = "")

    // 锚点框住 awaitSwitchAccountPanel() 函数体本身
    private fun awaitPanelFnBody(src: String): String =
        src.substringAfter("private suspend fun awaitSwitchAccountPanel(): AccessibilityNodeInfo? {", missingDelimiterValue = "")
            .substringBefore("\n    }", missingDelimiterValue = "")

    @Test
    fun `点切换账号后等待面板出现必须轮询多次而不是单次检查`() {
        val src = File(SOURCE_PATH).readText()
        val segment = waitSegment(src)
        assertTrue("等待段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "必须调用轮询等待函数(awaitSwitchAccountPanel)，不能只delay一次后调用" +
                "awaitRootInActiveWindow检查一次——那个函数只等\"任意根节点\"不等特定元素渲染完成，" +
                "真机复现面板动画/加载较慢时会检查过早",
            segment.contains("awaitSwitchAccountPanel()"),
        )
        val fnBody = awaitPanelFnBody(src)
        assertTrue("awaitSwitchAccountPanel 函数体锚点必须存在", fnBody.isNotEmpty())
        assertTrue(
            "必须循环多次重新取根节点检查recycler_view是否出现",
            fnBody.contains("repeat(") || fnBody.contains("for ("),
        )
        assertTrue(
            "轮询过程中必须重新检查 recycler_view 是否出现",
            fnBody.contains("recycler_view"),
        )
    }
}
