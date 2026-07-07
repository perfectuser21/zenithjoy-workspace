package com.zenithjoy.agent.onboarding
import android.content.Context
import android.provider.Settings

const val COLLECT_SERVICE_PKG = "com.zenithjoy.agent"
const val COLLECT_SERVICE_CLASS = "com.zenithjoy.agent.collect.DouyinCollectService"

/** 纯函数：enabled_accessibility_services 形如 pkg/cls:pkg/cls，判目标是否在内。 */
fun isServiceEnabled(enabledSetting: String?, pkg: String, serviceClass: String): Boolean {
    if (enabledSetting.isNullOrEmpty()) return false
    val target = "$pkg/$serviceClass"
    return enabledSetting.split(":").map { it.trim() }.any { it == target }
}

fun collectServiceEnabled(context: Context): Boolean {
    val setting = Settings.Secure.getString(
        context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    )
    return isServiceEnabled(setting, COLLECT_SERVICE_PKG, COLLECT_SERVICE_CLASS)
}
