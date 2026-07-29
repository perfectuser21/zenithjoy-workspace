package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-29，客户已交付环境MAA-AN00)：连续3次触发100%稳定复现同一失败——点击
 * "切换账号"节点后，捕获到的现场画面是抖音个人页头像区域的"更换背景(支持视频)/下载/关闭"
 * 浮层，不是真正的切换账号面板(recycler_view)。用户亲眼确认真机画面：账号昵称右边有个很
 * 小的下拉箭头才是真正的"切换账号"触发点，上方几乎整个大块区域都是"更换背景"的点击热区——
 * switchEntry 节点报告的中心坐标稍微偏一点就会落进这个大热区而不是命中那个小箭头。
 *
 * 修法：点击 switchEntry 后如果面板没出现，检测是否误触发了"更换背景"浮层，是的话先关闭它，
 * 再重新点一次 switchEntry 重试。
 *
 * 本仓库测试环境无 Mockito/Robolectric，照抄既有的源码静态检查写法。
 */
class DeviceAccountScanServiceProfileOverlayMisfireTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住"点击切换账号→检查面板→(可能的误触发处理)"这一段
    private fun misfireSegment(src: String): String =
        src.substringAfter("var panel = awaitSwitchAccountPanel()", missingDelimiterValue = "")
            .substringBefore("if (panel != null) {\n                    return true", missingDelimiterValue = "")

    @Test
    fun `点击切换账号面板未出现时必须检测更换背景误触发浮层并关闭重试`() {
        val src = File(SOURCE_PATH).readText()
        val segment = misfireSegment(src)
        assertTrue("误触发处理段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "必须检测'更换背景'这个误触发浮层的特征节点，不能面板一次没出现就直接判定失败",
            segment.contains("更换背景"),
        )
        assertTrue(
            "检测到误触发浮层后必须先点'关闭'把它关掉",
            segment.contains("\"关闭\""),
        )
        assertTrue(
            "关闭浮层后必须重新点一次 switchEntry 重试，不能关完就放弃",
            segment.contains("tapNodeCenter(switchEntry)"),
        )
        assertTrue(
            "重试后必须再次调用面板等待逻辑重新判定，不能假设关闭浮层后就一定成功",
            segment.contains("awaitSwitchAccountPanel()"),
        )
    }
}
