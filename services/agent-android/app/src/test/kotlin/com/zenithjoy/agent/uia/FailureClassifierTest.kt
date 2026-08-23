package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `failure != WaitFailure.NO_ROOT` 这条门禁在私信链 4 处（dm_entry/dm_message_input/
 * dm_search_entry/dm_search_input 的 decideRecovery 分支）、采集链 2 处（collect_comment_button/
 * collect_search_entry）各自手写了一遍——6 份完全相同的代码。另有 2 处（dm_send_button、
 * dm_search_input 重试耗尽分支）压根没写这条门禁，NO_ROOT（连树都没有）时也会白问一次 AI，
 * 虽 fail-open 兜底不会崩，但白白多打一次 TOAPIS + 落一条无意义病历。
 *
 * 抽出来是为了让接下来要铺的 ~34 个未接线点（采集链剩余点 + 扫号链全部）有唯一门禁可调，
 * 不必每个新点都重新对着老代码抄一遍 `!= NO_ROOT`。
 */
class FailureClassifierTest {

    @Test
    fun `NO_ROOT（连树都没有）不该问AI，问了也是空快照`() {
        assertEquals(false, FailureClassifier.shouldAssist(WaitFailure.NO_ROOT))
    }

    @Test
    fun `WRONG_FOREGROUND（前台被抢但树还在）该问AI——现有6个接线点都是这个判断`() {
        assertEquals(true, FailureClassifier.shouldAssist(WaitFailure.WRONG_FOREGROUND))
    }

    @Test
    fun `TARGET_ABSENT（前台对但元素没找到）该问AI——这是AI保底最主要覆盖的场景`() {
        assertEquals(true, FailureClassifier.shouldAssist(WaitFailure.TARGET_ABSENT))
    }
}
