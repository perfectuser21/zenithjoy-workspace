package com.zenithjoy.agent.collect

/**
 * 私信链的等待预算 —— 独立成对象是为了能被单测钉住，防止有人再把它调小。
 *
 * 真机 0821 实时录制（小粉 ANY-AN00，逐 0.5s 采样 topResumedActivity）：
 *   10:52:43 com.ss.android.ugc.aweme/.splash.SplashActivity
 *   10:52:53 com.ss.android.ugc.aweme/.search.activity.SearchResultActivity
 * **抖音冷启动闪屏整整 10 秒。**
 *
 * 而原来的页面级等待是 12×500ms = 6 秒 —— 先天不够，点击落在闪屏上是空操作，
 * 输入框永远等不到。这是 NO_SEARCH_INPUT 复发的一半原因（另一半见
 * [com.zenithjoy.agent.uia.decideRecovery]：前台被抢走时再长的等待也没用）。
 *
 * ⚠️ 别把 PAGE_ATTEMPTS 调回 12。单测 DmWaitBudgetTest 会拦。
 */
object DmWaitBudget {
    const val POLL_MS = 500L

    /** 页面级跳转（搜索页/主页）：24×500ms = 12 秒，覆盖实测 10 秒闪屏 + 2 秒余量 */
    const val PAGE_ATTEMPTS = 24
}
