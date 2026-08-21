package com.zenithjoy.agent.uia

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「包名是抖音」不等于「抖音可以操作了」—— 闪屏期间点击一律落空。
 *
 * 0821 真机实测（小粉 ANY-AN00，冷启动后逐 2 秒采样）：
 *   2s  SplashActivity   搜索节点数=1
 *   4s  SplashActivity   搜索节点数=1
 *   ...
 *   10s SplashActivity   搜索节点数=1
 *
 * **闪屏挂满 10 秒，而无障碍树在第 2 秒就已经能"看到"底下首页的搜索按钮。**
 * 于是 agent 在闪屏期间就判定"找到了"，点下去是空操作，再等输入框永远等不到 →
 * `NO_SEARCH_INPUT ... failure=TARGET_ABSENT`（前台确实是抖音，所以前台闸放行、
 * 消插屏也不触发——这正是它绕过前面两道防线的原因）。
 *
 * 今天失败分类：TARGET_ABSENT 3 次是最大一类，厂商插屏只占 1 次。
 * 前面两刀（#1687 重试、#1691 消插屏）都没打中它。
 */
class SplashGateTest {

    @Test
    fun `闪屏页必须判定为不可操作`() {
        assertFalse(isAppInteractive("com.ss.android.ugc.aweme", "com.ss.android.ugc.aweme.splash.SplashActivity"))
    }

    @Test
    fun `简写形式的闪屏类名也要认出来`() {
        assertFalse(isAppInteractive("com.ss.android.ugc.aweme", ".splash.SplashActivity"))
    }

    @Test
    fun `真正的业务页判定为可操作`() {
        assertTrue(isAppInteractive("com.ss.android.ugc.aweme", "com.ss.android.ugc.aweme.main.MainActivity"))
        assertTrue(isAppInteractive("com.ss.android.ugc.aweme", "com.ss.android.ugc.aweme.search.activity.SearchResultActivity"))
    }

    @Test
    fun `拿不到 Activity 名时不能误判为不可操作——宁可放行也别把正常流程卡死`() {
        assertTrue(isAppInteractive("com.ss.android.ugc.aweme", null))
    }

    @Test
    fun `前台压根不是目标包时直接判不可操作`() {
        assertFalse(isAppInteractive("com.hihonor.systemmanager", "com.hihonor.x.YActivity"))
    }
}
