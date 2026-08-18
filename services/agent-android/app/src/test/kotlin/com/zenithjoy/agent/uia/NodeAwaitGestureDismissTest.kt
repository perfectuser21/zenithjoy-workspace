package com.zenithjoy.agent.uia

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 源码静态守卫：共享前台闸消除厂商插屏必须用**手势点击**，不能用 performAction(ACTION_CLICK)。
 *
 * 依据（真机复现 2026-07-29，ANY-AN00 设备，见 DeviceAccountScanServiceVendorPopupDismissTest）：
 * 该 App 生态里 ACTION_CLICK 对部分节点无效——真机 tree_dump 证实点厂商壁纸推荐弹窗的「关闭」
 * 毫无反应，弹窗一直卡到 awaitDouyinForeground() 超时，最终报 OPEN_PANEL_FAILED。
 *
 * 2026-08-18 把前台闸提为共享设施时，初版共享实现用了 ACTION_CLICK，正是被 account-scan 那条
 * 守卫拦下来的。此处再加一条守在共享实现自己身上，避免以后有人只看共享文件、把它改回去。
 */
class NodeAwaitGestureDismissTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt"

    private fun fnBody(src: String): String =
        src.substringAfter("suspend fun AccessibilityService.awaitAppForeground(", missingDelimiterValue = "")

    @Test
    fun `awaitAppForeground 消除厂商插屏必须用手势点击`() {
        val src = File(SOURCE_PATH).readText()
        val fn = fnBody(src)
        assertTrue("awaitAppForeground 锚点必须存在", fn.isNotEmpty())
        assertTrue(
            "消除插屏必须走 dispatchGesture 手势点击——真机证实 ACTION_CLICK 对厂商弹窗无效",
            fn.contains("tapNodeCenterByGesture("),
        )
        assertTrue(
            "不能用 performAction(ACTION_CLICK) 消除插屏（真机点了没反应，卡到超时）",
            !fn.contains("performAction(AccessibilityNodeInfo.ACTION_CLICK)"),
        )
    }
}
