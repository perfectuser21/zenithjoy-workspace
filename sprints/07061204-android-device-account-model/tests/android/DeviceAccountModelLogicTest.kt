package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sprint 07061204-android-device-account-model — Golden Path Step 2/3/5/7 纯函数合同。
 *
 * 四块纯逻辑，完全脱离 Android 框架（无 AccessibilityNodeInfo/Context/DB 依赖），
 * 可直接用 JUnit 在 JVM 上跑，落地 Android 设备账号扫描的判定标准：
 *
 * 1. `dedupeSameDeviceAccounts` — 单次扫描内账号去重
 * 2. `resolveDeviceConflict` — 双端登录冲突覆盖判定（以后上报者为准，PRD NFR）
 * 3. `filterAccountsByTenant` — tenant_id 绑定隔离（多租户互不串，Invariant 铁律）
 * 4. `resolveScanReadResult` — 扫描读取失败时保留旧列表标记 stale（不用空值覆盖）
 * 5. `checkAccountOffline` — 账号下线判定
 * 6. `evaluateDispatchAccountStatus` — 派发时发现未登录 → 立即触发重扫，任务按未登录处理
 * 7. `shouldSkipScanDueToMutex` — 全局互斥锁判定（采集/触达任务运行中本轮扫描跳过）
 *
 * `DeviceAccountModel` 尚未提供这些函数（TDD Red）— Generator 需要在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountModel.kt
 * 新增 `object DeviceAccountModel`，内含：
 *   - `fun dedupeSameDeviceAccounts(scannedDouyinIds: List<String>): List<String>`
 *   - `internal enum class ConflictResolution { NO_CONFLICT, OVERWRITE_EXISTING, KEEP_EXISTING_STALE_REPORT }`
 *   - `fun resolveDeviceConflict(existingDeviceId: String?, existingScanAtMs: Long?, newDeviceId: String, newScanAtMs: Long): ConflictResolution`
 *   - `fun shouldInvalidateOldDeviceRecord(resolution: ConflictResolution): Boolean`（Round 2 新增：落地"旧设备记录标为失效"，仅 OVERWRITE_EXISTING 为 true）
 *   - `fun shouldLogConflictAlert(resolution: ConflictResolution): Boolean`（Round 2 新增：落地"写日志告警"，仅 OVERWRITE_EXISTING 为 true）
 *   - `data class ScannedAccount(val douyinId: String, val deviceId: String, val tenantId: String, val scanAtMs: Long)`
 *   - `fun filterAccountsByTenant(all: List<ScannedAccount>, tenantId: String): List<ScannedAccount>`
 *   - `internal enum class ScanReadOutcome { UPDATE_ACTIVE_LIST, KEEP_PREVIOUS_MARK_STALE }`
 *   - `fun resolveScanReadResult(readSucceeded: Boolean): ScanReadOutcome`
 *   - `internal enum class AccountOfflineStatus { ONLINE, WENT_OFFLINE }`
 *   - `fun checkAccountOffline(recordedDouyinId: String, currentlyLoggedInIds: List<String>): AccountOfflineStatus`
 *   - `internal enum class DispatchAccountDecision { PROCEED, TRIGGER_RESCAN_AND_FAIL }`
 *   - `fun evaluateDispatchAccountStatus(recordedOnline: Boolean, actualLoggedInAtDispatch: Boolean): DispatchAccountDecision`
 *   - `fun shouldSkipScanDueToMutex(isCollectOrOutreachRunning: Boolean): Boolean`
 *
 * 冲突覆盖判定标准（`resolveDeviceConflict`）：
 * - `existingDeviceId == null`（该账号此前未在任何设备记录过）→ `NO_CONFLICT`（首次绑定，非冲突）
 * - `existingDeviceId == newDeviceId`（同一设备重复上报）→ `NO_CONFLICT`
 * - 设备不同且 `newScanAtMs >= existingScanAtMs`（新上报时间戳不早于旧记录）→ `OVERWRITE_EXISTING`（以后上报者为准，旧设备记录标为失效并写日志告警）
 * - 设备不同且 `newScanAtMs < existingScanAtMs`（新上报是网络延迟导致的过期消息）→ `KEEP_EXISTING_STALE_REPORT`（不覆盖，丢弃过期上报）
 */
class DeviceAccountModelLogicTest {

    // ── dedupeSameDeviceAccounts ─────────────────────────────────────────────

    @Test
    fun `duplicate douyin ids in single scan are deduped preserving order`() {
        val scanned = listOf("douyin_a", "douyin_b", "douyin_a", "douyin_c", "douyin_b")
        assertEquals(
            listOf("douyin_a", "douyin_b", "douyin_c"),
            DeviceAccountModel.dedupeSameDeviceAccounts(scanned),
        )
    }

    @Test
    fun `scan with no duplicates is unaffected`() {
        val scanned = listOf("douyin_a", "douyin_b", "douyin_c")
        assertEquals(scanned, DeviceAccountModel.dedupeSameDeviceAccounts(scanned))
    }

    @Test
    fun `empty scan list dedupes to empty list`() {
        assertEquals(emptyList<String>(), DeviceAccountModel.dedupeSameDeviceAccounts(emptyList()))
    }

    // ── resolveDeviceConflict（双端冲突覆盖判定，以后上报者为准）──────────────────

    @Test
    fun `no existing binding (first scan) yields NO_CONFLICT`() {
        assertEquals(
            DeviceAccountModel.ConflictResolution.NO_CONFLICT,
            DeviceAccountModel.resolveDeviceConflict(
                existingDeviceId = null,
                existingScanAtMs = null,
                newDeviceId = "device-A",
                newScanAtMs = 1_000_000L,
            ),
        )
    }

    @Test
    fun `same device rescanning yields NO_CONFLICT`() {
        assertEquals(
            DeviceAccountModel.ConflictResolution.NO_CONFLICT,
            DeviceAccountModel.resolveDeviceConflict(
                existingDeviceId = "device-A",
                existingScanAtMs = 1_000_000L,
                newDeviceId = "device-A",
                newScanAtMs = 2_000_000L,
            ),
        )
    }

    @Test
    fun `different device with later scan timestamp overwrites existing`() {
        assertEquals(
            DeviceAccountModel.ConflictResolution.OVERWRITE_EXISTING,
            DeviceAccountModel.resolveDeviceConflict(
                existingDeviceId = "device-A",
                existingScanAtMs = 1_000_000L,
                newDeviceId = "device-B",
                newScanAtMs = 2_000_000L,
            ),
        )
    }

    @Test
    fun `different device with equal scan timestamp overwrites existing (later reporter wins ties)`() {
        assertEquals(
            DeviceAccountModel.ConflictResolution.OVERWRITE_EXISTING,
            DeviceAccountModel.resolveDeviceConflict(
                existingDeviceId = "device-A",
                existingScanAtMs = 1_000_000L,
                newDeviceId = "device-B",
                newScanAtMs = 1_000_000L,
            ),
        )
    }

    @Test
    fun `different device with earlier (stale, out-of-order) scan timestamp keeps existing`() {
        assertEquals(
            DeviceAccountModel.ConflictResolution.KEEP_EXISTING_STALE_REPORT,
            DeviceAccountModel.resolveDeviceConflict(
                existingDeviceId = "device-A",
                existingScanAtMs = 2_000_000L,
                newDeviceId = "device-B",
                newScanAtMs = 1_000_000L,
            ),
        )
    }

    // ── shouldInvalidateOldDeviceRecord / shouldLogConflictAlert（Round 2 新增：Step 5 后半句"标失效+写日志告警"）──

    @Test
    fun `OVERWRITE_EXISTING resolution should invalidate old device record`() {
        assertTrue(
            DeviceAccountModel.shouldInvalidateOldDeviceRecord(DeviceAccountModel.ConflictResolution.OVERWRITE_EXISTING),
        )
    }

    @Test
    fun `NO_CONFLICT resolution should not invalidate old device record`() {
        assertFalse(
            DeviceAccountModel.shouldInvalidateOldDeviceRecord(DeviceAccountModel.ConflictResolution.NO_CONFLICT),
        )
    }

    @Test
    fun `KEEP_EXISTING_STALE_REPORT resolution should not invalidate old device record`() {
        assertFalse(
            DeviceAccountModel.shouldInvalidateOldDeviceRecord(DeviceAccountModel.ConflictResolution.KEEP_EXISTING_STALE_REPORT),
        )
    }

    @Test
    fun `OVERWRITE_EXISTING resolution should log conflict alert`() {
        assertTrue(
            DeviceAccountModel.shouldLogConflictAlert(DeviceAccountModel.ConflictResolution.OVERWRITE_EXISTING),
        )
    }

    @Test
    fun `NO_CONFLICT resolution should not log conflict alert`() {
        assertFalse(
            DeviceAccountModel.shouldLogConflictAlert(DeviceAccountModel.ConflictResolution.NO_CONFLICT),
        )
    }

    @Test
    fun `KEEP_EXISTING_STALE_REPORT resolution should not log conflict alert`() {
        assertFalse(
            DeviceAccountModel.shouldLogConflictAlert(DeviceAccountModel.ConflictResolution.KEEP_EXISTING_STALE_REPORT),
        )
    }

    // ── filterAccountsByTenant（tenant_id 绑定隔离，多租户互不串）───────────────

    @Test
    fun `filters accounts to only the queried tenant, excluding other tenants`() {
        val all = listOf(
            DeviceAccountModel.ScannedAccount("douyin_a", "device-A", "tenant-1", 1_000L),
            DeviceAccountModel.ScannedAccount("douyin_b", "device-A", "tenant-2", 2_000L),
            DeviceAccountModel.ScannedAccount("douyin_c", "device-B", "tenant-1", 3_000L),
        )
        val result = DeviceAccountModel.filterAccountsByTenant(all, "tenant-1")
        assertEquals(
            listOf(
                DeviceAccountModel.ScannedAccount("douyin_a", "device-A", "tenant-1", 1_000L),
                DeviceAccountModel.ScannedAccount("douyin_c", "device-B", "tenant-1", 3_000L),
            ),
            result,
        )
    }

    @Test
    fun `second tenant query returns only its own accounts, none leak from tenant-1`() {
        val all = listOf(
            DeviceAccountModel.ScannedAccount("douyin_a", "device-A", "tenant-1", 1_000L),
            DeviceAccountModel.ScannedAccount("douyin_b", "device-A", "tenant-2", 2_000L),
        )
        val result = DeviceAccountModel.filterAccountsByTenant(all, "tenant-2")
        assertEquals(listOf(DeviceAccountModel.ScannedAccount("douyin_b", "device-A", "tenant-2", 2_000L)), result)
    }

    @Test
    fun `tenant with no matching accounts returns empty list`() {
        val all = listOf(DeviceAccountModel.ScannedAccount("douyin_a", "device-A", "tenant-1", 1_000L))
        assertEquals(emptyList<DeviceAccountModel.ScannedAccount>(), DeviceAccountModel.filterAccountsByTenant(all, "tenant-9"))
    }

    @Test
    fun `empty account list filters to empty regardless of tenant`() {
        assertEquals(
            emptyList<DeviceAccountModel.ScannedAccount>(),
            DeviceAccountModel.filterAccountsByTenant(emptyList(), "tenant-1"),
        )
    }

    // ── resolveScanReadResult（读取失败保留旧列表标记 stale，不用空值覆盖）────────

    @Test
    fun `successful scan read updates active list`() {
        assertEquals(
            DeviceAccountModel.ScanReadOutcome.UPDATE_ACTIVE_LIST,
            DeviceAccountModel.resolveScanReadResult(readSucceeded = true),
        )
    }

    @Test
    fun `failed scan read (accessibility timeout etc) keeps previous list and marks stale`() {
        assertEquals(
            DeviceAccountModel.ScanReadOutcome.KEEP_PREVIOUS_MARK_STALE,
            DeviceAccountModel.resolveScanReadResult(readSucceeded = false),
        )
    }

    // ── checkAccountOffline（下线判定）───────────────────────────────────────

    @Test
    fun `account still present in currently logged-in list is ONLINE`() {
        assertEquals(
            DeviceAccountModel.AccountOfflineStatus.ONLINE,
            DeviceAccountModel.checkAccountOffline("douyin_target", listOf("douyin_other", "douyin_target")),
        )
    }

    @Test
    fun `account missing from currently logged-in list WENT_OFFLINE`() {
        assertEquals(
            DeviceAccountModel.AccountOfflineStatus.WENT_OFFLINE,
            DeviceAccountModel.checkAccountOffline("douyin_target", listOf("douyin_other")),
        )
    }

    @Test
    fun `empty currently logged-in list means account WENT_OFFLINE`() {
        assertEquals(
            DeviceAccountModel.AccountOfflineStatus.WENT_OFFLINE,
            DeviceAccountModel.checkAccountOffline("douyin_target", emptyList()),
        )
    }

    // ── evaluateDispatchAccountStatus（派发时发现未登录 → 立即重扫，任务按未登录处理）─

    @Test
    fun `dispatch finds account recorded online but actually logged out triggers rescan and fails task`() {
        assertEquals(
            DeviceAccountModel.DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL,
            DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = true, actualLoggedInAtDispatch = false),
        )
    }

    @Test
    fun `dispatch finds account recorded online and actually still logged in proceeds normally`() {
        assertEquals(
            DeviceAccountModel.DispatchAccountDecision.PROCEED,
            DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = true, actualLoggedInAtDispatch = true),
        )
    }

    @Test
    fun `dispatch finds account already recorded offline and still logged out proceeds (no new mismatch)`() {
        assertEquals(
            DeviceAccountModel.DispatchAccountDecision.PROCEED,
            DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = false, actualLoggedInAtDispatch = false),
        )
    }

    @Test
    fun `dispatch finds account recorded offline but actually logged in proceeds (no mismatch failure)`() {
        assertEquals(
            DeviceAccountModel.DispatchAccountDecision.PROCEED,
            DeviceAccountModel.evaluateDispatchAccountStatus(recordedOnline = false, actualLoggedInAtDispatch = true),
        )
    }

    // ── shouldSkipScanDueToMutex（全局互斥锁判定）────────────────────────────

    @Test
    fun `collect or outreach task running means scan should be skipped this cycle`() {
        assertTrue(DeviceAccountModel.shouldSkipScanDueToMutex(isCollectOrOutreachRunning = true))
    }

    @Test
    fun `no collect or outreach task running means scan should proceed`() {
        assertFalse(DeviceAccountModel.shouldSkipScanDueToMutex(isCollectOrOutreachRunning = false))
    }
}
