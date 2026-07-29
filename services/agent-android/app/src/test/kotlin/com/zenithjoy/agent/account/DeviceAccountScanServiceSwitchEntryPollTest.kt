package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-28，staging agent_scan_failures表，2台设备afc3505c/f182e64e共3次干净复现)：
 * openSwitchAccountPanel() 点"我"tab后检查"切换账号"入口是否出现，原实现只 delay(1500L) 后
 * 单次检查一次——个人页渲染较慢时(CLEAR_TOP冷启动/头像等网络内容加载)检查过早，误判为
 * "未见切换账号"转CLEAR_TOP重试；因为每轮重试走的是同一条固定延迟路径，3次重试会系统性
 * 命中同一时序窗口全部失败(两台干净设备的失败 tree_dump 均显示"我，按钮"节点其实一直都在，
 * 但从未进入个人页)。同文件 readMyProfile() 已验证过的做法是轮询等待
 * (`repeat(4){delay(800L);查"抖音号"锚点}`)而不是单次固定延迟，此处必须对齐同一模式。
 *
 * 本仓库测试环境无 Mockito/Robolectric，无法构造真实 AccessibilityNodeInfo 树驱动运行时行为，
 * 照抄 DeviceAccountScanServiceMeTabLocateTest 的源码静态检查写法。
 */
class DeviceAccountScanServiceSwitchEntryPollTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住"点我tab之后、判定切换账号是否出现"这一段等待逻辑，不含前面选 我tab 节点/坐标兜底的分支，
    // 也不含找到 switchEntry 之后点击面板出现的等待（那段本来就有 delay(800L) 不是本次复现的问题）。
    private fun waitSegment(src: String): String =
        src.substringAfter("tapAtCoordinate(meX, meY) // 我 tab\n            }", missingDelimiterValue = "")
            .substringBefore("if (switchEntry != null) {", missingDelimiterValue = "")

    @Test
    fun `点我tab后等待切换账号入口出现必须轮询多次而不是单次固定delay`() {
        val src = File(SOURCE_PATH).readText()
        val segment = waitSegment(src)
        assertTrue("等待段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "必须像 readMyProfile() 一样用循环轮询等待个人页渲染出现\"切换账号\"入口，不能只" +
                " delay(1500L) 检查一次——真机复现个人页渲染慢于1500ms时会误判OPEN_PANEL_FAILED",
            segment.contains("repeat(") || segment.contains("for (") || segment.contains("while ("),
        )
    }

    @Test
    fun `切换账号轮询等待每轮delay不少于readMyProfile同款的800毫秒`() {
        val src = File(SOURCE_PATH).readText()
        val segment = waitSegment(src)
        assertTrue("等待段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "轮询间隔太短起不到等待个人页渲染的作用，应对齐 readMyProfile() 的 delay(800L)",
            segment.contains("delay(800L)"),
        )
    }
}
