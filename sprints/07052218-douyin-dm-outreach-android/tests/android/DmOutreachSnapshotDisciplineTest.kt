package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

/**
 * Sprint 07052218 — 私信触达无障碍操作"点击后必须重新抓取快照"纪律（复用 PR #1119/#1120
 * DouyinCollectService 已验证过的真机根因修复模式：点击前的旧 root 快照跳转后不可复用）。
 *
 * SnapshotDiscipline 尚未实现（TDD Red） — Generator 需在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/SnapshotDiscipline.kt
 * 新增 `object SnapshotDiscipline`，用可测的整型 token（抓取计数器/快照序号）建模
 * "每次点击后必须重新抓取"这条规则，不依赖真实 AccessibilityNodeInfo（本项目单测无
 * Robolectric/mockk，仅能测纯函数，参照 DouyinCollectServiceStateTest 现有写法）。
 */
class DmOutreachSnapshotDisciplineTest {

    @Test
    fun `fetch count increases after click means fresh snapshot was taken`() {
        // 点击前抓取计数=3，点击后再次抓取变为4 → 判定为"确实重新抓取过"
        assertTrue(SnapshotDiscipline.wasRefetchedAfterClick(fetchCountBeforeClick = 3, fetchCountAfterClick = 4))
    }

    @Test
    fun `same fetch count after click means snapshot was reused (violation)`() {
        // 点击后抓取计数未变化 → 说明复用了点击前的旧快照，判定为违规
        assertFalse(SnapshotDiscipline.wasRefetchedAfterClick(fetchCountBeforeClick = 3, fetchCountAfterClick = 3))
    }

    @Test
    fun `two consecutive clicks must each trigger their own refetch`() {
        // 模拟"打开主页"点击 + "点私信入口"点击 两次连续操作，各自都必须重新抓取
        val afterOpenProfile = SnapshotDiscipline.nextFetchToken(previousToken = 0)
        val afterClickDm = SnapshotDiscipline.nextFetchToken(previousToken = afterOpenProfile)
        assertTrue(afterOpenProfile > 0)
        assertTrue(afterClickDm > afterOpenProfile)
    }

    @Test
    fun `requireFresh throws when snapshot token has not advanced`() {
        var threw = false
        try {
            SnapshotDiscipline.requireFresh(previousToken = 5, currentToken = 5)
        } catch (e: IllegalStateException) {
            threw = true
        }
        assertTrue("应在快照 token 未推进时抛出异常，禁止静默复用旧快照", threw)
    }
}
