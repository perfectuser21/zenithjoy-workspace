package com.zenithjoy.agent

import com.zenithjoy.agent.account.DeviceAccountModel
import com.zenithjoy.agent.account.DeviceAccountRegistry
import com.zenithjoy.agent.account.DeviceAccountScanService
import com.zenithjoy.agent.account.ScanMutex
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Judge 复核发现的缺陷 A（阻塞）：`routeDmOutreachTask` 派发前一致性核对
 * （Golden Path Step 7）此前直接把 `profile_url`（DM 目标收件人主页 URL）传给
 * `DeviceAccountScanService.checkDispatchConsistency`，但 `DeviceAccountRegistry`
 * 的 key 是"本机登录发送账号"的 douyinId（`account_label`），两者是完全不同的命名
 * 空间——用 profile_url 去查，`isRecordedOnline` 永远命中"未扫描到过，默认放行"分支，
 * 守卫永久空转，即使发送账号已下线也恒为 PROCEED。
 *
 * 本测试针对被抽出的纯函数 [AgentService.resolveDispatchGuardAccountId]（`routeDmOutreachTask`
 * 内部用它来决定"该拿哪个 payload 字段去核对派发一致性"，不依赖 Android Service 生命周期，
 * 因此可以脱离 Robolectric 直接单测）：
 *   1. 验证该函数解析出的必须是 account_label，不是 profile_url。
 *   2. 端到端串联 DeviceAccountRegistry + checkDispatchConsistency，证明：
 *      - 用修复前的错误标识符（profile_url）核对，即使发送账号在 registry 里已被标记下线，
 *        依然恒为 PROCEED（复现问题）。
 *      - 用修复后的正确标识符（account_label）核对，同样的下线状态能正确触发
 *        TRIGGER_RESCAN_AND_FAIL。
 */
class AgentServiceDispatchGuardTest {

    @After
    fun resetState() {
        ScanMutex.busy = false
    }

    @Test
    fun `resolveDispatchGuardAccountId picks account_label not profile_url`() {
        val payload = mapOf(
            "profile_url" to "https://www.douyin.com/user/some-target-profile",
            "account_label" to "douyin_sender_burner_1",
            "message" to "hi",
        )

        val resolved = AgentService.resolveDispatchGuardAccountId(payload)

        assertEquals("douyin_sender_burner_1", resolved)
        assertNotEquals("https://www.douyin.com/user/some-target-profile", resolved)
    }

    @Test
    fun `dispatch guard using the fixed account_label identifier catches an offline sending account`() {
        // 发送账号（本机登录的抖音号）在最近一次设备扫描中被标记为已下线。
        DeviceAccountRegistry.update(
            "douyin_sender_burner_1",
            DeviceAccountRegistry.Entry(deviceId = "device-A", tenantId = "tenant-1", scanAtMs = 1L, online = false),
        )

        val payload = mapOf(
            "profile_url" to "https://www.douyin.com/user/some-target-profile",
            "account_label" to "douyin_sender_burner_1",
            "message" to "hi",
        )

        // 修复后：guard 用 resolveDispatchGuardAccountId 解析出的 account_label 去核对。
        val fixedDecision = DeviceAccountScanService.checkDispatchConsistency(
            AgentService.resolveDispatchGuardAccountId(payload),
        )
        assertEquals(DeviceAccountModel.DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL, fixedDecision)

        // 复现修复前的缺陷：直接用 profile_url（从未写进 registry 的命名空间）核对，
        // 即使同一个发送账号已经下线，也恒为 PROCEED —— 守卫空转。
        val buggyDecision = DeviceAccountScanService.checkDispatchConsistency(
            payload["profile_url"] as String,
        )
        assertEquals(DeviceAccountModel.DispatchAccountDecision.PROCEED, buggyDecision)
    }
}
