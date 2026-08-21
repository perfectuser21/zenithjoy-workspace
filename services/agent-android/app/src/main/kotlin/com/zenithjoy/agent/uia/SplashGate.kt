package com.zenithjoy.agent.uia

/**
 * 「包名是目标 App」≠「目标 App 可以操作了」。
 *
 * 0821 真机实测（小粉 ANY-AN00，冷启动后逐 2 秒采样 topResumedActivity + 搜索节点数）：
 *   2s / 4s / 6s / 8s / 10s 全是 SplashActivity，而**搜索节点从第 2 秒就找得到**
 *   ——无障碍树能看到闪屏底下的首页。
 *
 * 后果：agent 在闪屏期间就判定"搜索按钮找到了"，点下去是空操作（闪屏吃掉了点击），
 * 然后等输入框，等到超时 → `NO_SEARCH_INPUT ... failure=TARGET_ABSENT`。
 * 前台确实是抖音，所以前台闸放行、[decideInterloperAction] 也不触发——
 * **这正是它能绕过前面两道防线的原因**（#1687 重试、#1691 消插屏都没打中它）。
 *
 * 今天的失败分类里 TARGET_ABSENT 是最大一类（3/7），厂商插屏只占 1/7。
 */

/** 闪屏 Activity 的类名特征。用包含匹配而非全等——各 App 的闪屏类名不统一，
 *  且 dumpsys 里既可能是全限定名也可能是 `.splash.SplashActivity` 这种简写。 */
private val SPLASH_MARKERS = listOf("splash", "Splash", "launcher.LauncherActivity", "AdActivity")

/**
 * 目标 App 现在能不能操作。
 *
 * @param currentPkg 当前前台包名
 * @param currentActivity 当前前台 Activity 类名；**拿不到时视为可操作**——
 *   宁可放行也别把正常流程卡死（读不到 Activity 是常态，不是异常信号）。
 * @param targetPkg 期望的目标包名；前台不是它就直接判不可操作。
 */
fun isAppInteractive(currentPkg: String?, currentActivity: String?, targetPkg: String): Boolean {
    if (currentPkg != targetPkg) return false
    if (currentActivity == null) return true
    return SPLASH_MARKERS.none { currentActivity.contains(it, ignoreCase = true) }
}
