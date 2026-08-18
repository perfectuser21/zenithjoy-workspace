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

    // 三个锚点把"我"tab 分支精确切成三段：查找表达式 / 命中分支 / 未命中分支。
    // 用 missingDelimiterValue = "" 让锚点缺失时直接判空——如果有人把 if/else 结构
    // 改回无条件坐标点、或删掉查找逻辑，锚点会消失，取到的段落变成空字符串，
    // 后续 contains 断言必然失败，而不是像 substringAfter 默认行为那样"锚点找不到
    // 就退化成整个文件"，从而被文件里其它地方同名调用（switchEntry 那段也用了
    // findNodeByContentDescContains/tapNodeCenter）蹭过去。
    private fun lookupExpr(src: String): String =
        src.substringAfter("val meTabOutcome = awaitNode(", missingDelimiterValue = "")
            .substringBefore("if (meTabNode != null) {", missingDelimiterValue = "")

    private fun foundBranch(src: String): String =
        src.substringAfter("if (meTabNode != null) {", missingDelimiterValue = "")
            .substringBefore("} else {", missingDelimiterValue = "")

    private fun fallbackBranch(src: String): String =
        src.substringAfter("} else {", missingDelimiterValue = "")
            .substringBefore("delay(1500L)", missingDelimiterValue = "")

    @Test
    fun `openSwitchAccountPanel 点我tab前先按内容描述或文本查找真实节点`() {
        val src = File(SOURCE_PATH).readText()
        val lookup = lookupExpr(src)
        assertTrue("查找表达式锚点必须存在（结构被改动会导致这里判空）", lookup.isNotEmpty())
        assertTrue(
            "应查找内容描述含\"我，按钮\"的节点",
            lookup.contains("findNodeByContentDescContains(it, \"我，按钮\")"),
        )
        assertTrue(
            "查内容描述落空时应再按精确文本\"我\"兜底查找",
            lookup.contains("findNodeByText(it, \"我\")"),
        )
        assertTrue(
            "精确文本\"我\"命中率高但不受控(信息流UGC内容可能偶然等于单字\"我\")，" +
                "必须再过一层底部导航区域位置校验，不能直接采信",
            lookup.contains("isInBottomNavArea("),
        )
    }

    @Test
    fun `底部导航区域判定用屏幕高度比例而不是写死像素值`() {
        val src = File(SOURCE_PATH).readText()
        val fn = src.substringAfter("private fun isInBottomNavArea(", missingDelimiterValue = "")
            .substringBefore("\n    }", missingDelimiterValue = "")
        assertTrue("isInBottomNavArea 函数体锚点必须存在", fn.isNotEmpty())
        assertTrue(
            "必须按 screenHeight 的比例判定，不能为单一机型写死绝对像素阈值",
            fn.contains("screenHeight *"),
        )
    }

    @Test
    fun `找到我tab节点时点节点中心，而不是直接坐标点`() {
        val src = File(SOURCE_PATH).readText()
        val found = foundBranch(src)
        assertTrue("命中分支锚点必须存在（if/else 结构被拍平会导致这里判空）", found.isNotEmpty())
        assertTrue(
            "命中真实节点时必须调 tapNodeCenter(meTabNode)，不能落到坐标兜底",
            found.contains("tapNodeCenter(meTabNode)"),
        )
        assertTrue(
            "命中分支不该再调坐标兜底",
            !found.contains("tapAtCoordinate(meX, meY)"),
        )
    }

    @Test
    fun `找不到我tab节点时才退回坐标兜底，不能整段删掉`() {
        val src = File(SOURCE_PATH).readText()
        val fallback = fallbackBranch(src)
        assertTrue("兜底分支锚点必须存在（if/else 结构被拍平会导致这里判空）", fallback.isNotEmpty())
        assertTrue(
            "旧机型上我tab可能确实不进无障碍树，兜底分支必须保留坐标点击",
            fallback.contains("tapAtCoordinate(meX, meY)"),
        )
        assertTrue(
            "兜底分支不该调 tapNodeCenter（那是命中分支的行为）",
            !fallback.contains("tapNodeCenter("),
        )
    }
}
