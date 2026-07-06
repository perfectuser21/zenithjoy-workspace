package com.zenithjoy.agent

import com.zenithjoy.agent.account.DeviceAccountModel
import com.zenithjoy.agent.account.DeviceAccountRegistry
import com.zenithjoy.agent.account.DeviceAccountScanService
import com.zenithjoy.agent.account.ScanMutex
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 2026-07-06 复查更新：此前的测试循环论证——手工把 `DeviceAccountRegistry` 的 key 和
 * `payload["account_label"]` 设成同一个人为编造的字符串，"验证"两者相等，但这两个字符串
 * 在真实数据流里完全没有任何东西保证它们相等（account_label 是中台绑定小号时用户自己起的
 * 任意字符串，见 apps/api/src/routes/agent-burner.ts `initiate-bind`；registry 的 key 是
 * 扫描面板读到的真实抖音号 douyinId）。测试通过不代表"派发前一致性核对"真的生效。
 *
 * 现改为验证真实调用契约：`DeviceAccountScanService.checkDispatchConsistency` 现在接收的是
 * "本机 deviceId"（不是任何账号标识符），做的是按设备维度的近似判定——
 * "本机本轮扫描到的账号是否全部下线"。本测试直接驱动这个真实签名/真实判定，
 * 不再依赖任何"两个字符串恰好相等"的编造前提。
 */
class AgentServiceDispatchGuardTest {

    @After
    fun resetState() {
        ScanMutex.busy = false
    }

    @Test
    fun `dispatch guard fails and triggers rescan when this device's only known account went offline`() {
        val deviceId = "device-guard-test-all-offline"
        DeviceAccountRegistry.update(
            "douyin_sender_burner_1",
            DeviceAccountRegistry.Entry(deviceId = deviceId, tenantId = "tenant-1", scanAtMs = 1L, online = false),
        )

        val decision = DeviceAccountScanService.checkDispatchConsistency(deviceId)

        assertEquals(DeviceAccountModel.DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL, decision)
    }

    @Test
    fun `dispatch guard proceeds when this device still has at least one online account`() {
        val deviceId = "device-guard-test-mixed"
        DeviceAccountRegistry.update(
            "douyin_sender_burner_offline",
            DeviceAccountRegistry.Entry(deviceId = deviceId, tenantId = "tenant-1", scanAtMs = 1L, online = false),
        )
        DeviceAccountRegistry.update(
            "douyin_sender_burner_online",
            DeviceAccountRegistry.Entry(deviceId = deviceId, tenantId = "tenant-1", scanAtMs = 2L, online = true),
        )

        val decision = DeviceAccountScanService.checkDispatchConsistency(deviceId)

        assertEquals(DeviceAccountModel.DispatchAccountDecision.PROCEED, decision)
    }

    @Test
    fun `dispatch guard proceeds when this device has never reported a scan (unknown, do not block)`() {
        val decision = DeviceAccountScanService.checkDispatchConsistency("device-guard-test-never-scanned")

        assertEquals(DeviceAccountModel.DispatchAccountDecision.PROCEED, decision)
    }
}
