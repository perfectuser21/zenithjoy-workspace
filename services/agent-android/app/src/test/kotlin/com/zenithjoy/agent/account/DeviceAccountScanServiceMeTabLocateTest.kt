package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 静态检查：确认"我"tab 定位优先走无障碍树节点查找，坐标降级为兜底（不是唯一手段）。
 * 真机复现(2026-07-20，华为AN00机型)：openSwitchAccountPanel() 原实现无条件用固定屏幕
 * 比例坐标(sw*0.90,sh*0.979)点"我"tab，代码注释断言"我 tab 是 Lynx 渲染不进无障碍树，
 * 只能坐标点"——但真机诊断截图+树摘要证实这个假设在该机型上不成立(树里能查到
 * desc=我，按钮 txt=我 的真实节点)，坐标点偏导致 OPEN_PANEL_FAILED。本仓库测试环境无
 * Mockito/Robolectric，无法构造真实 AccessibilityNodeInfo 树验证运行时行为，照抄
 * DeviceAccountScanServiceBroadcastTest 的源码静态检查写法。
 */
class DeviceAccountScanServiceMeTabLocateTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    @Test
    fun `openSwitchAccountPanel 点我tab前先按内容描述或文本查找真实节点`() {
        val src = File(SOURCE_PATH).readText()
        val body = src.substringAfter("override suspend fun openSwitchAccountPanel(): Boolean {")
            .substringBefore("\n    /**\n     * 拉起抖音并【顶回主页 feed】")
        assertTrue(
            "应在点击我tab前查找内容描述含\"我，按钮\"的节点",
            body.contains("findNodeByContentDescContains") && body.contains("我，按钮"),
        )
        assertTrue(
            "查内容描述落空时应再按精确文本\"我\"兜底查找",
            body.contains("findNodeByText(") && body.contains("\"我\""),
        )
    }

    @Test
    fun `找到我tab节点时优先点节点中心，而不是直接坐标点`() {
        val src = File(SOURCE_PATH).readText()
        val body = src.substringAfter("override suspend fun openSwitchAccountPanel(): Boolean {")
            .substringBefore("\n    /**\n     * 拉起抖音并【顶回主页 feed】")
        assertTrue(
            "命中真实节点时应调 tapNodeCenter，不能只有坐标兜底这一条路",
            body.contains("tapNodeCenter("),
        )
    }

    @Test
    fun `坐标点击仍然保留作为找不到节点时的兜底，不能整段删掉`() {
        val src = File(SOURCE_PATH).readText()
        val body = src.substringAfter("override suspend fun openSwitchAccountPanel(): Boolean {")
            .substringBefore("\n    /**\n     * 拉起抖音并【顶回主页 feed】")
        assertTrue(
            "旧机型上我tab可能确实不进无障碍树，坐标兜底不能删，只能降级为 else 分支",
            body.contains("tapAtCoordinate(meX, meY)"),
        )
    }
}
