package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-29，客户已交付环境，ANY-AN00设备)：awaitDouyinForeground() 消除厂商弹窗
 * (荣耀壁纸推荐/开屏广告等)时用 performAction(ACTION_CLICK)，但同文件已有先例证明该 App 生态里
 * ACTION_CLICK 对部分节点无效(见 openSwitchAccountPanel() 里"切换账号"节点改用 tapNodeCenter 的注释：
 * "ACTION_CLICK 对抖音部分节点无效")。真机 tree_dump 证实点了弹窗的"关闭"按钮没反应，弹窗一直卡着
 * 直到 awaitDouyinForeground() 超时，openSwitchAccountPanel() 在最开头"抖音未到前台"这一步就直接
 * 失败——跟已修复的 PR #1523(我tab点击等待逻辑)完全是不同的根因，只是报同一个 OPEN_PANEL_FAILED
 * 错误码。修法：把弹窗消除的点击换成已验证过的手势点击(tapNodeCenter)。
 *
 * 本仓库测试环境无 Mockito/Robolectric，照抄 DeviceAccountScanServiceMeTabLocateTest 的源码
 * 静态检查写法。
 */
class DeviceAccountScanServiceVendorPopupDismissTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住 awaitDouyinForeground() 函数体
    private fun fnBody(src: String): String =
        src.substringAfter("private suspend fun awaitDouyinForeground(", missingDelimiterValue = "")
            .substringBefore("\n    private fun collectAllNodeTexts", missingDelimiterValue = "")

    @Test
    fun `awaitDouyinForeground消除厂商弹窗必须用手势点击而不是ACTION_CLICK`() {
        val src = File(SOURCE_PATH).readText()
        val fn = fnBody(src)
        assertTrue("awaitDouyinForeground 函数体锚点必须存在（结构被改动会导致这里判空）", fn.isNotEmpty())
        assertTrue(
            "消除弹窗必须调 tapNodeCenter(dismiss) 走手势点击——同文件已证明 ACTION_CLICK 对该 App 生态" +
                "部分节点无效(真机复现：厂商壁纸推荐弹窗点\"关闭\"没反应，卡到超时)",
            fn.contains("tapNodeCenter(dismiss)"),
        )
        assertTrue(
            "不能再用不可靠的 performAction(ACTION_CLICK) 消除弹窗",
            !fn.contains("performAction(AccessibilityNodeInfo.ACTION_CLICK)"),
        )
    }
}
