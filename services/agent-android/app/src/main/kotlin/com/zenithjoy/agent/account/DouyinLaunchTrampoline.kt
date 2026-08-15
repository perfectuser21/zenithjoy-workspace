package com.zenithjoy.agent.account

import android.content.Context
import android.content.Intent

/**
 * 账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1，decisions 964ba941/61298fc6/7ea333a3）。
 *
 * 真机实证（4号机 MAA-AN00 荣耀 Android 15，同机同包对照）：无障碍服务从后台直接
 * startActivity 拉抖音被荣耀 iAware 拒绝（logcat `prevent start activity by iaware`，
 * result 102）0/5；1px 无障碍 overlay 0/3（AOSP 判可见窗口放行、iAware 仍拦——它认的是
 * "调用方有前台 Activity"）；先 startActivity 自家 Activity 再拉抖音 3/3。
 *
 * 所以拉抖音改为两跳：Service → [DouyinLaunchTrampolineActivity]（透明、无 UI、不进最近
 * 任务）→ 目标 App。本 object 只放常量与纯逻辑；Intent 构造只由 Activity/Service 调用
 * （本 repo JVM 单测不能构造 android Intent，见 DouyinLaunchTrampolineTest）。
 */
object DouyinLaunchTrampoline {
    const val EXTRA_TARGET_PACKAGE = "com.zenithjoy.agent.extra.LAUNCH_TARGET_PACKAGE"

    /** 与 DeviceAccountScanService.DOUYIN_PKG 是同一常量，不留两份字面量。 */
    const val DEFAULT_TARGET_PACKAGE = DeviceAccountScanService.DOUYIN_PKG

    /** trampoline 自身从 Service 上下文启动，必须 NEW_TASK。 */
    const val TRAMPOLINE_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK

    /** 目标 App 的启动 flags，与改动前 launchDouyinApp() 直启完全一致。 */
    const val TARGET_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP

    fun resolveTargetPackage(extra: String?): String =
        extra?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_TARGET_PACKAGE

    fun buildTrampolineIntent(context: Context, targetPackage: String): Intent =
        Intent(context, DouyinLaunchTrampolineActivity::class.java)
            .addFlags(TRAMPOLINE_FLAGS)
            .putExtra(EXTRA_TARGET_PACKAGE, targetPackage)
}
