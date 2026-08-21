package com.zenithjoy.agent.collect

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 等待预算必须覆盖真机实测的抖音冷启动闪屏时长。
 *
 * 0821 小粉实时录制（逐 0.5s 采样 topResumedActivity）：
 *   10:52:43 com.ss.android.ugc.aweme/.splash.SplashActivity
 *   10:52:53 com.ss.android.ugc.aweme/.search.activity.SearchResultActivity
 * 闪屏整整 10 秒。而页面级等待原本是 12×500ms=6 秒，先天不够。
 */
class DmWaitBudgetTest {

    @Test
    fun `页面级等待预算必须不小于实测闪屏 10 秒`() {
        val budgetMs = DmWaitBudget.PAGE_ATTEMPTS * DmWaitBudget.POLL_MS
        assertTrue(
            "页面级等待 ${budgetMs}ms 覆盖不了真机实测的 10000ms 闪屏",
            budgetMs >= 10_000,
        )
    }
}
