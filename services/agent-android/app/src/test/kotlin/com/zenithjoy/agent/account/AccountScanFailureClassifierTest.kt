package com.zenithjoy.agent.account

import org.junit.Assert.assertFalse
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
}
