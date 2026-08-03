package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Agent 诊断页"后台弹窗权限"自检展示项的纯逻辑单测（sprint 08031620-android-scan-preconditions）。
 * 真实权限读取走 Settings.canDrawOverlays(context)（Android 框架调用，本仓库无 Robolectric，
 * 不在 JVM 单测覆盖范围）——本测试只验证"读到的布尔值 → 展示文案"这一纯函数分支，
 * 尽力而为信号，不保证覆盖所有厂商后台启动限制的真实状态（见 sprint-prd.md 假设段）。
 */
class BackgroundPermissionCheckTest {

    @Test
    fun `已授权时展示正常文案`() {
        val desc = BackgroundPermissionCheck.describeOverlayPermission(canDrawOverlays = true)
        assertTrue(desc.contains("已授权"))
    }

    @Test
    fun `未授权时展示风险提示文案`() {
        val desc = BackgroundPermissionCheck.describeOverlayPermission(canDrawOverlays = false)
        assertTrue(desc.contains("未授权"))
        assertTrue(desc.contains("LAUNCH_BLOCKED"))
    }
}
