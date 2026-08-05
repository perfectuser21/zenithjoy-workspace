package com.zenithjoy.agent.account

/**
 * Agent 诊断页"后台弹窗权限"自检展示项的纯逻辑（sprint 08031620-android-scan-preconditions）。
 * 真实权限读取走 Settings.canDrawOverlays(context)（Android 框架调用，本函数只处理已读取到的
 * 布尔值 → 展示文案这一步），尽力而为信号，不保证覆盖所有厂商后台启动限制的真实状态。
 */
object BackgroundPermissionCheck {
    fun describeOverlayPermission(canDrawOverlays: Boolean): String =
        if (canDrawOverlays) {
            "后台弹窗权限：已授权（正常）"
        } else {
            "后台弹窗权限：未授权（可能导致账号扫描报 LAUNCH_BLOCKED，建议在系统设置中手动开启后台弹窗/自启动权限）"
        }
}
