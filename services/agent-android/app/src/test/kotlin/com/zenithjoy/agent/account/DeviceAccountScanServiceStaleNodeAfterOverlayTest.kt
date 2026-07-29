package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-29，客户已交付环境MAA-AN00，PR#1554已合并的"检测更换背景浮层→关闭"逻辑
 * 真实生效后)：日志证实检测到浮层并成功关闭("点击切换账号误触发更换背景浮层，关闭后重试")，
 * 但关闭后复用关闭前拿到的旧 switchEntry 节点引用重新点击，依然"点了切换账号但面板未出现"。
 * 根因：关闭浮层后页面树已经刷新，旧 AccessibilityNodeInfo 引用可能已失效，对失效节点
 * 点击会静默无效果——必须重新从当前根节点查一次"切换账号"节点再点击。
 *
 * 同时PR#1554新增的这一步让单次attempt耗时明显变长，真机复现3次CLEAR_TOP重试原30秒预算
 * 不够用，会在跑完前被整体超时打断(报SCAN_TIMEOUT而不是更明确的OPEN_PANEL_FAILED)，需要
 * 调大整体超时预算。
 *
 * 本仓库测试环境无 Mockito/Robolectric，照抄既有的源码静态检查写法。
 */
class DeviceAccountScanServiceStaleNodeAfterOverlayTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住"关闭更换背景浮层→重新点击switchEntry"这一段
    private fun retrySegment(src: String): String =
        src.substringAfter("tapNodeCenter(closeBtn)", missingDelimiterValue = "")
            .substringBefore("panel = awaitSwitchAccountPanel()", missingDelimiterValue = "")

    @Test
    fun `关闭更换背景浮层后必须重新查找切换账号节点而不是复用旧引用`() {
        val src = File(SOURCE_PATH).readText()
        val segment = retrySegment(src)
        assertTrue("重试段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "关闭浮层后页面树已刷新，必须重新从当前根节点查一次'切换账号'节点，不能直接" +
                "tapNodeCenter(switchEntry)复用关闭浮层前拿到的旧节点引用——那个引用可能已失效",
            segment.contains("findNodeByContentDescContains") &&
                segment.contains("\"切换账号\""),
        )
        assertTrue(
            "重新点击必须点新查到的节点，不能是旧的switchEntry变量本身",
            !segment.trimEnd().endsWith("tapNodeCenter(switchEntry)"),
        )
    }

    @Test
    fun `整体扫描超时预算必须放宽以容纳新增的浮层检测重试步骤`() {
        val src = File(SOURCE_PATH).readText()
        val timeoutLine = src.lines().firstOrNull { it.contains("SCAN_TOTAL_TIMEOUT_MS =") } ?: ""
        assertTrue("SCAN_TOTAL_TIMEOUT_MS 定义行必须存在", timeoutLine.isNotEmpty())
        val value = Regex("""(\d+)_000L""").find(timeoutLine)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        assertTrue(
            "SCAN_TOTAL_TIMEOUT_MS 必须大于30秒——原30秒预算在新增浮层检测重试步骤后" +
                "真机复现跑不完3次重试就被整体超时打断(SCAN_TIMEOUT)，实际值=${value}",
            value > 30,
        )
    }
}
