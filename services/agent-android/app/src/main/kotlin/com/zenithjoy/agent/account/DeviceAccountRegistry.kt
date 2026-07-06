package com.zenithjoy.agent.account

import java.util.concurrent.ConcurrentHashMap

/**
 * Sprint 07061301-device-account-scan-wiring — 进程内存态的"最近一次扫描结果"注册表。
 *
 * 每轮账号扫描（[DeviceAccountScanService]）成功读取后，把本机当前登录的抖音账号
 * 及其在线态写进这里；供：
 *   - 下一轮扫描时作为 `resolveDeviceConflict`/`checkAccountOffline` 的"已知记录"输入
 *   - [AgentService] 在派发采集/触达任务前，用 `evaluateDispatchAccountStatus` 核对
 *     "任务假设账号在线" 与 "本机最近一次扫描记录" 是否一致（Golden Path Step 7）
 *
 * 纯进程内存态，随 Agent 重启清零；跨进程重启持久化（写回中台 `agent_platform_sessions`）
 * 由 [AgentService] 负责上报，不在本注册表职责内。
 */
object DeviceAccountRegistry {

    data class Entry(
        val deviceId: String,
        val tenantId: String,
        val scanAtMs: Long,
        val online: Boolean,
    )

    private val accounts = ConcurrentHashMap<String, Entry>()

    fun update(douyinId: String, entry: Entry) {
        accounts[douyinId] = entry
    }

    fun get(douyinId: String): Entry? = accounts[douyinId]

    /** 供扫描时构造 `resolveDeviceConflict` 的"已知记录"输入。 */
    fun snapshot(): Map<String, Entry> = accounts.toMap()

    /**
     * 供 [AgentService] 派发前一致性核对：未扫描到过的账号（无历史记录）默认放行
     * （不能因为"从没扫描过"就阻断合法任务派发）。
     */
    fun isRecordedOnline(douyinId: String): Boolean = accounts[douyinId]?.online ?: true
}
