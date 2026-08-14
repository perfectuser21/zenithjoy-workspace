package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * AccountScanFailureClassifier：OPEN_PANEL_FAILED 大杂烩拆分层的核心判定纯函数（sprint
 * 08031620-android-scan-preconditions）。用两条真实历史失败记录的原始 tree_dump 做 fixture
 * （agent_scan_failures.id da659ea0 锁屏 / 236f43b1 launcher），验证判定正确性，不 mock
 * AccessibilityService 本身——真机真实触发场景由 nightly account-scan-realmachine-smoke.sh
 * 车道回归覆盖（见 contract-draft.md「未覆盖真实链路清单」）。
 */
class AccountScanFailureClassifierTest {

    // Fixture A：07-31 真实锁屏记录（agent_scan_failures.id = da659ea0-b0f8-40f1-9126-1af4351330f1）
    private val lockScreenTreeDump = """
        #0 cls=android.widget.TextView click=false b=168x57 desc=null txt=中国电信
        #1 cls=android.widget.ImageView click=false b=63x72 desc=振铃器振动。 txt=null
        #5 cls=android.widget.ImageView click=true b=151x0 desc=录音机 txt=null
        #10 cls=android.widget.TextView click=false b=184x62 desc=null txt=上滑解锁
        #11 cls=android.widget.TextView click=false b=370x70 desc=null txt=7月31日星期五
        #13 cls=android.widget.TextView click=false b=1042x308 desc=null txt=15:26
        end printed=59
    """.trimIndent()

    // Fixture B：07-30 真实 launcher 记录（agent_scan_failures.id = 236f43b1-d073-41c9-81c7-6bd9433accea，realme RMX3478）
    private val homeLauncherTreeDump = """
        #0 cls=android.widget.TextView click=true b=246x252 desc=拨号 txt=null
        #2 cls=android.widget.TextView click=true b=246x252 desc="微信"有 61 条通知 txt=null
        #12 cls=android.widget.TextView click=true b=246x306 desc="抖音"有 1 条通知 txt=抖音
        #17 cls=android.widget.TextView click=true b=213x306 desc=ZenithJoy Agent txt=ZenithJoy Agent
        end printed=18
    """.trimIndent()

    // 正常态结构性反例：既有代码依赖的正常态标记文本（"我，按钮"/"切换账号"），不含锁屏/桌面特征
    private val normalDouyinTreeDump = """
        #0 cls=android.widget.TextView click=false b=100x50 desc=null txt=推荐
        #5 cls=android.widget.ImageView click=true b=80x80 desc=我，按钮 txt=我
        #6 cls=android.widget.TextView click=true b=200x60 desc=切换账号，用户名有6条未读消息 txt=null
        end printed=7
    """.trimIndent()

    @Test
    fun `07-31 真实锁屏 tree_dump 被判定为锁屏`() {
        assertTrue(AccountScanFailureClassifier.isLockScreenTreeDump(lockScreenTreeDump))
    }

    @Test
    fun `07-30 真实 launcher tree_dump 被判定为桌面 launcher`() {
        assertTrue(AccountScanFailureClassifier.isHomeLauncherTreeDump(homeLauncherTreeDump))
    }

    @Test
    fun `正常抖音树不被误判为锁屏（假阳性防护）`() {
        assertFalse(AccountScanFailureClassifier.isLockScreenTreeDump(normalDouyinTreeDump))
    }

    @Test
    fun `正常抖音树不被误判为桌面 launcher（假阳性防护）`() {
        assertFalse(AccountScanFailureClassifier.isHomeLauncherTreeDump(normalDouyinTreeDump))
    }

    @Test
    fun `null 或空 tree_dump 不崩溃且两分类均返回 false`() {
        assertFalse(AccountScanFailureClassifier.isLockScreenTreeDump(null))
        assertFalse(AccountScanFailureClassifier.isHomeLauncherTreeDump(null))
        assertFalse(AccountScanFailureClassifier.isLockScreenTreeDump(""))
        assertFalse(AccountScanFailureClassifier.isHomeLauncherTreeDump(""))
    }

    @Test
    fun `锁屏树不应同时被判定为桌面 launcher`() {
        assertFalse(AccountScanFailureClassifier.isHomeLauncherTreeDump(lockScreenTreeDump))
    }

    @Test
    fun `launcher 树不应同时被判定为锁屏`() {
        assertFalse(AccountScanFailureClassifier.isLockScreenTreeDump(homeLauncherTreeDump))
    }

    // ── classifyScreenshotCaptureFailure：诊断截图捕获失败原因分类（本次bug修复） ──
    // 根因（真机复现 08-11 run 31427538362，task_id=8a251802-...）：captureFailureDiagnostics()
    // 此前把"服务未初始化"/"截图返回null"/"截图抛异常"三种不同原因，用同一个 try/catch
    // 静默坍缩成同一个不可区分的 null——DB 里 screenshot_b64 恒为 null，导致历次
    // OPEN_PANEL_FAILED 现场都无法判断截图诊断本身为什么瞎，只能靠信息量少得多的 tree_dump。

    @Test
    fun `截图服务未初始化(sharedScreenCaptureService为null)时分类为 service_null`() {
        assertEquals(
            "service_null",
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = false, threwMessage = null, resultIsNull = true,
            ),
        )
    }

    @Test
    fun `截图抛异常时分类为 capture_threw 并携带异常信息`() {
        assertEquals(
            "capture_threw:boom",
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = true, threwMessage = "boom", resultIsNull = true,
            ),
        )
    }

    @Test
    fun `服务可用且未抛异常但截图仍返回null时分类为 capture_returned_null`() {
        assertEquals(
            "capture_returned_null",
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = true, threwMessage = null, resultIsNull = true,
            ),
        )
    }

    @Test
    fun `截图成功捕获(非null)时返回null——代表不是失败`() {
        assertNull(
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = true, threwMessage = null, resultIsNull = false,
            ),
        )
    }

    @Test
    fun `三种失败原因互不相同——回归本次bug(此前全部坍缩成同一个null)`() {
        val reasons = setOf(
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = false, threwMessage = null, resultIsNull = true,
            ),
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = true, threwMessage = "x", resultIsNull = true,
            ),
            AccountScanFailureClassifier.classifyScreenshotCaptureFailure(
                serviceAvailable = true, threwMessage = null, resultIsNull = true,
            ),
        )
        assertEquals("三种失败场景必须产生三个不同的可观测原因", 3, reasons.size)
    }
}
