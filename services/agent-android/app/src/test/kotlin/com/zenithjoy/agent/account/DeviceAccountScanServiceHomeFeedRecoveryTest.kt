package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(2026-07-29，客户已交付环境MAA-AN00，用 adb dumpsys window/activity 实时确认)：
 * `mCurrentFocus=com.ss.android.ugc.aweme/.profile.ui.ProfileCoverPreviewActivity`——这是
 * 抖音自己的"个人主页封面预览/更换"子页面，包名依然匹配 DOUYIN_PKG，`awaitDouyinForeground()`
 * 判定"已到前台"直接放行，但这类子页面没有底部导航栏，导致后续"我"tab查找/坐标兜底全部
 * 落空，3次 CLEAR_TOP 重试全部按同样方式失败(之前误判为厂商弹窗，PR #1536 那次修复对此
 * 无效——因为流程根本不会进入消除弹窗那段逻辑)。
 *
 * 修法：每次尝试点"我"tab前，加一层恢复循环——检测不到底部导航栏特征(我/首页按钮)时
 * 多按几次返回键退回主页feed，而不是冒然对着错误页面点坐标/CLEAR_TOP重来。
 *
 * 本仓库测试环境无 Mockito/Robolectric，照抄既有的源码静态检查写法。
 */
class DeviceAccountScanServiceHomeFeedRecoveryTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    // 锚点框住"我tab点击"这一步之前、CLEAR_TOP重试逻辑之后的这一段
    private fun recoverySegment(src: String): String =
        src.substringAfter("launchDouyinApp(); awaitDouyinForeground(maxAttempts = 8); delay(2000L)\n            }", missingDelimiterValue = "")
            .substringBefore("val preTapRoot = awaitRootInActiveWindow()", missingDelimiterValue = "")

    @Test
    fun `点我tab前必须先恢复到有底部导航栏的主页feed`() {
        val src = File(SOURCE_PATH).readText()
        val segment = recoverySegment(src)
        assertTrue("恢复段锚点必须存在（结构被改动会导致这里判空）", segment.isNotEmpty())
        assertTrue(
            "必须检测底部导航栏特征(我/首页按钮)是否存在，不能假设包名对了就是在主页feed",
            segment.contains("我，按钮") && segment.contains("首页，按钮"),
        )
        assertTrue(
            "检测不到底部导航栏时必须按返回键尝试退回主页，而不是直接对着错误页面点坐标",
            segment.contains("GLOBAL_ACTION_BACK"),
        )
        assertTrue(
            "恢复必须是循环多次尝试(单次返回键可能退不完深层子页面栈)，不能只按一次",
            segment.contains("for (") || segment.contains("repeat("),
        )
        assertTrue(
            "命中主页feed后必须真正跳出循环(break)，不能只是repeat{ return@repeat }这种" +
                "会白跑完剩余轮次的continue语义",
            segment.contains("break") || !segment.contains("repeat("),
        )
    }
}
