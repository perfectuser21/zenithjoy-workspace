package com.zenithjoy.agent.account

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1，decision 61298fc6）。
 * 荣耀 iAware 拒绝无障碍服务从后台直接拉起抖音；修法是先起自家透明 trampoline Activity。
 * 本测试锁定 trampoline 的纯逻辑：目标包名解析 + 两组 Intent flags 与原直启一致。
 */
class DouyinLaunchTrampolineTest {

    @Test
    fun `空或空白 extra 退回默认抖音包`() {
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage(null))
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage(""))
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage("   "))
    }

    @Test
    fun `显式包名去空白后原样返回`() {
        assertEquals("com.example.other", DouyinLaunchTrampoline.resolveTargetPackage(" com.example.other "))
    }

    @Test
    fun `默认目标包与 DeviceAccountScanService 的 DOUYIN_PKG 是同一常量`() {
        assertEquals(DeviceAccountScanService.DOUYIN_PKG, DouyinLaunchTrampoline.DEFAULT_TARGET_PACKAGE)
    }

    @Test
    fun `目标启动 flags 含 NEW_TASK 与 CLEAR_TOP（与原直启一致）`() {
        assertTrue(DouyinLaunchTrampoline.TARGET_FLAGS and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(DouyinLaunchTrampoline.TARGET_FLAGS and Intent.FLAG_ACTIVITY_CLEAR_TOP != 0)
    }

    @Test
    fun `trampoline 自身 flags 含 NEW_TASK（从 Service 上下文启动所需）`() {
        assertTrue(DouyinLaunchTrampoline.TRAMPOLINE_FLAGS and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }
}
