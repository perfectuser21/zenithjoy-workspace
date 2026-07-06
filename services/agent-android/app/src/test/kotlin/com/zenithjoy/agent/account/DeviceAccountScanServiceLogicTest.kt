package com.zenithjoy.agent.account

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sprint 07061301-device-account-scan-wiring — 修 PR #1131 遗留的"孤立工具类"反模式：
 * DeviceAccountModel 的 9 个纯函数全仓库零调用点。本测试针对 DeviceAccountScanService
 * 里驱动真实扫描流程的判定函数（本类是无障碍服务，AccessibilityNodeInfo 相关代码本身
 * 无法脱离真机/Robolectric 单测，但驱动扫描决策的纯函数必须真实调用 DeviceAccountModel
 * 并可测）。
 *
 * DeviceAccountScanService 尚未实现（TDD Red）— Generator 需要新增：
 *   - `object ScanMutex { var busy: Boolean }`（account 包，三服务共享的全局互斥标记）
 *   - `object DeviceAccountRegistry`（account 包，扫描后写入的最新账号在线态注册表）
 *   - `class DeviceAccountScanService : AccessibilityService()`，companion object 提供：
 *     `internal fun shouldRunScan(): Boolean`
 *     `internal data class ScanReadResolution(val accountIds: List<String>, val stale: Boolean)`
 *     `internal fun resolveAccountsToPersist(readSucceeded: Boolean, previousKnownIds: List<String>, freshlyScannedRawIds: List<String>): ScanReadResolution`
 *     `internal data class AccountScanDecision(val douyinId: String, val conflict: DeviceAccountModel.ConflictResolution, val invalidateOld: Boolean, val logAlert: Boolean)`
 *     `internal fun buildScanDecisions(dedupedIds: List<String>, thisDeviceId: String, tenantId: String, scanAtMs: Long, knownRecords: Map<String, DeviceAccountRegistry.Entry>): List<AccountScanDecision>`
 *     `internal fun applyOfflineDetection(knownDouyinIds: List<String>, currentlyLoggedInIds: List<String>): Map<String, DeviceAccountModel.AccountOfflineStatus>`
 *     `internal fun checkDispatchConsistency(douyinId: String): DeviceAccountModel.DispatchAccountDecision`
 */
class DeviceAccountScanServiceLogicTest {

    @After
    fun resetMutex() {
        ScanMutex.busy = false
    }

    // ── ScanMutex + shouldRunScan（Step 1：全局互斥锁判定）───────────────────────

    @Test
    fun `scan should run when mutex is free`() {
        ScanMutex.busy = false
        assertTrue(DeviceAccountScanService.shouldRunScan())
    }

    @Test
    fun `scan should be skipped when collect or outreach holds the mutex`() {
        ScanMutex.busy = true
        assertFalse(DeviceAccountScanService.shouldRunScan())
    }

    // ── resolveAccountsToPersist（Step 2：读取失败保留旧列表标记 stale）──────────

    @Test
    fun `successful read replaces previous list with deduped fresh scan, not stale`() {
        val result = DeviceAccountScanService.resolveAccountsToPersist(
            readSucceeded = true,
            previousKnownIds = listOf("douyin_old"),
            freshlyScannedRawIds = listOf("douyin_a", "douyin_b", "douyin_a"),
        )
        assertEquals(listOf("douyin_a", "douyin_b"), result.accountIds)
        assertFalse(result.stale)
    }

    @Test
    fun `failed read keeps previous known list and marks stale`() {
        val result = DeviceAccountScanService.resolveAccountsToPersist(
            readSucceeded = false,
            previousKnownIds = listOf("douyin_old_a", "douyin_old_b"),
            freshlyScannedRawIds = listOf("douyin_should_be_ignored"),
        )
        assertEquals(listOf("douyin_old_a", "douyin_old_b"), result.accountIds)
        assertTrue(result.stale)
    }

    // ── buildScanDecisions（Step 3-5：去重 → 冲突覆盖判定+标失效+告警）────────────

    @Test
    fun `first-time scan of a brand new account yields NO_CONFLICT and no invalidate no alert`() {
        val decisions = DeviceAccountScanService.buildScanDecisions(
            dedupedIds = listOf("douyin_new"),
            thisDeviceId = "device-A",
            tenantId = "tenant-1",
            scanAtMs = 1_000_000L,
            knownRecords = emptyMap(),
        )
        assertEquals(1, decisions.size)
        val decision = decisions[0]
        assertEquals("douyin_new", decision.douyinId)
        assertEquals(DeviceAccountModel.ConflictResolution.NO_CONFLICT, decision.conflict)
        assertFalse(decision.invalidateOld)
        assertFalse(decision.logAlert)
    }

    @Test
    fun `account previously bound to another device with an older scan timestamp is overwritten with invalidate and alert`() {
        val known = mapOf(
            "douyin_moved" to DeviceAccountRegistry.Entry(
                deviceId = "device-OLD",
                tenantId = "tenant-1",
                scanAtMs = 500_000L,
                online = true,
            ),
        )
        val decisions = DeviceAccountScanService.buildScanDecisions(
            dedupedIds = listOf("douyin_moved"),
            thisDeviceId = "device-NEW",
            tenantId = "tenant-1",
            scanAtMs = 1_000_000L,
            knownRecords = known,
        )
        val decision = decisions.single()
        assertEquals(DeviceAccountModel.ConflictResolution.OVERWRITE_EXISTING, decision.conflict)
        assertTrue(decision.invalidateOld)
        assertTrue(decision.logAlert)
    }

    @Test
    fun `same device rescanning an already-known account yields NO_CONFLICT`() {
        val known = mapOf(
            "douyin_same" to DeviceAccountRegistry.Entry(
                deviceId = "device-A",
                tenantId = "tenant-1",
                scanAtMs = 500_000L,
                online = true,
            ),
        )
        val decisions = DeviceAccountScanService.buildScanDecisions(
            dedupedIds = listOf("douyin_same"),
            thisDeviceId = "device-A",
            tenantId = "tenant-1",
            scanAtMs = 1_000_000L,
            knownRecords = known,
        )
        val decision = decisions.single()
        assertEquals(DeviceAccountModel.ConflictResolution.NO_CONFLICT, decision.conflict)
        assertFalse(decision.invalidateOld)
        assertFalse(decision.logAlert)
    }

    @Test
    fun `duplicate raw ids collapse to a single decision`() {
        val decisions = DeviceAccountScanService.buildScanDecisions(
            dedupedIds = DeviceAccountModel.dedupeSameDeviceAccounts(listOf("douyin_x", "douyin_x")),
            thisDeviceId = "device-A",
            tenantId = "tenant-1",
            scanAtMs = 1_000_000L,
            knownRecords = emptyMap(),
        )
        assertEquals(1, decisions.size)
    }

    // ── DeviceAccountRegistry + applyOfflineDetection（下线判定接线，Step 6）────

    @Test
    fun `registry marks known account offline when missing from a fresh scan`() {
        DeviceAccountRegistry.update("douyin_still_there", DeviceAccountRegistry.Entry("device-A", "tenant-1", 1L, online = true))
        DeviceAccountRegistry.update("douyin_gone", DeviceAccountRegistry.Entry("device-A", "tenant-1", 1L, online = true))

        val statuses = DeviceAccountScanService.applyOfflineDetection(
            knownDouyinIds = listOf("douyin_still_there", "douyin_gone"),
            currentlyLoggedInIds = listOf("douyin_still_there"),
        )

        assertEquals(DeviceAccountModel.AccountOfflineStatus.ONLINE, statuses["douyin_still_there"])
        assertEquals(DeviceAccountModel.AccountOfflineStatus.WENT_OFFLINE, statuses["douyin_gone"])
    }

    // ── evaluateDispatchAccountStatus 接线（Step 7：派发前一致性核对）───────────

    @Test
    fun `dispatch guard triggers rescan and fail when registry shows account went offline`() {
        DeviceAccountRegistry.update("douyin_dispatch_target", DeviceAccountRegistry.Entry("device-A", "tenant-1", 1L, online = false))
        val decision = DeviceAccountScanService.checkDispatchConsistency("douyin_dispatch_target")
        assertEquals(DeviceAccountModel.DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL, decision)
    }

    @Test
    fun `dispatch guard proceeds when registry has no record for the account (unknown, do not block)`() {
        val decision = DeviceAccountScanService.checkDispatchConsistency("douyin_never_scanned")
        assertEquals(DeviceAccountModel.DispatchAccountDecision.PROCEED, decision)
    }
}
