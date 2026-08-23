package com.zenithjoy.agent.account

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现(0824，HONOR ANY-AN00，request_id r-verify2-final/r-verify2-final2)：AI on-call
 * 两次分别答错(未读角标 id=1u_ / 无关评论文案 id=zuu)，因为该候选确实存在于当前树里
 * (node != null)，`tryLocatorAssist` 立即把 verified=true 上报进
 * `zenithjoy.rpa_locator_assist` 缓存表，此后同一 (step,device,os,douyin版本) 格子永久
 * 重放这个错误答案，账号扫描任务连续两轮分别以 OPEN_PANEL_FAILED/SCAN_TIMEOUT 失败。
 * node!=null 只证明"AI 指认的东西确实是树里某个真实节点"，不证明"点它真的达成了这一步
 * 该做的事"。本仓库测试环境无 Mockito/Robolectric，照抄
 * DeviceAccountScanServiceMeTabLocateTest 的源码静态锚点检查写法。
 */
class DeviceAccountScanServiceAssistVerifiedTimingTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    private fun tryLocatorAssistBody(src: String): String =
        src.substringAfter(
            "private suspend fun tryLocatorAssist(step: String, targetDesc: String, errorCode: String): LocatorAssistOutcome? {",
            missingDelimiterValue = "",
        ).substringBefore("\n    /** 按候选矩形在当前树里找回节点", missingDelimiterValue = "")

    @Test
    fun `tryLocatorAssist 返回壳携带 assistId 和 httpBase，不再是裸 node`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue(
            "必须存在 LocatorAssistOutcome 返回壳（node/assistId/httpBase），" +
                "不能再直接返回 AccessibilityNodeInfo?",
            src.contains("private data class LocatorAssistOutcome("),
        )
        assertTrue(
            "tryLocatorAssist 的返回类型必须是 LocatorAssistOutcome?",
            src.contains(
                "private suspend fun tryLocatorAssist(step: String, targetDesc: String, errorCode: String): LocatorAssistOutcome? {",
            ),
        )
    }

    @Test
    fun `node找到分支不再立即上报verified=true——真实结果留给调用方`() {
        val src = File(SOURCE_PATH).readText()
        val body = tryLocatorAssistBody(src)
        assertTrue("tryLocatorAssist 函数体锚点必须存在", body.isNotEmpty())
        assertFalse(
            "AI 答错时选中的候选也可能是树里真实存在的无关节点(未读角标/评论文案)，" +
                "node!=null 只证明树里有这个东西、不证明点它达成了目的——函数体内不能再对" +
                "\"node 找到\"这个分支直接调用 reportVerifiedBlocking(httpBase, aid, node != null)",
            body.contains("reportVerifiedBlocking(httpBase, aid, node != null)"),
        )
        assertTrue(
            "node 确实为 null（AI 指认的东西压根不在树里）仍是可信的强负信号，" +
                "必须保留立即上报 false",
            body.contains("reportVerifiedBlocking(httpBase, aid, false)"),
        )
        assertTrue(
            "函数末尾必须把 node/assistId/httpBase 一起打包返回，交给调用方在" +
                "知道真实任务结果后自行上报",
            body.contains("return LocatorAssistOutcome(node, aid, httpBase)"),
        )
    }

    @Test
    fun `scan_me_tab调用点在switchEntry真实结果出来后才上报verified`() {
        val src = File(SOURCE_PATH).readText()
        val fromCall = src.substringAfter(
            "meTabAssist = tryLocatorAssist(\"scan_me_tab\", \"底部导航栏「我」tab（个人主页入口）\", \"NO_ME_TAB\")",
            missingDelimiterValue = "",
        )
        assertTrue("scan_me_tab 调用点锚点必须存在", fromCall.isNotEmpty())
        val untilSwitchEntryCheck = fromCall.substringBefore(
            "if (switchEntry != null) break",
            missingDelimiterValue = "",
        )
        assertTrue(
            "switchEntry 真实结果轮询锚点必须存在于 scan_me_tab 调用点之后",
            untilSwitchEntryCheck.isNotEmpty(),
        )
        val afterSwitchEntryLoop = fromCall.substringAfter(
            "if (switchEntry != null) break",
            missingDelimiterValue = "",
        )
        assertTrue(
            "必须在拿到 switchEntry 真实结果（!= null 才算这一步真的达成目的）之后，" +
                "用 meTabAssist 的 assistId/httpBase 上报 verified=(switchEntry != null)，" +
                "而不是在 tryLocatorAssist 内部提前用 node!=null 上报",
            afterSwitchEntryLoop.contains("reportVerifiedBlocking(") &&
                afterSwitchEntryLoop.contains("switchEntry != null"),
        )
    }
}
