package com.zenithjoy.agent.account

/**
 * Sprint 07061301-device-account-scan-wiring — 三个无障碍服务（账号扫描 /
 * DouyinCollectService 采集 / DouyinDmOutreachService 触达）共享的全局互斥标记。
 *
 * 只做最简单的可读写布尔标志位（`@Volatile`保证跨线程可见性，Android 无障碍服务的
 * 回调可能来自不同线程/协程调度器）。采集/触达服务在各自任务开始时置 `true`、
 * 结束（成功/失败/超时）时置回 `false`；账号扫描服务在触发扫描前读取本标记，
 * 用 `DeviceAccountModel.shouldSkipScanDueToMutex` 判定本轮是否跳过。
 *
 * ⚠️ 本对象只提供布尔标志的原子可见性，不提供获取/释放的原子性（TOCTOU 窗口期
 * 仍可能被其他服务抢占）——见 sprint 07061204 contract-draft.md 风险登记 #4，
 * 真正的原子锁是未来 sprint 待办项，本 sprint 范围内先接通"读写"这一层。
 */
object ScanMutex {
    @Volatile
    var busy: Boolean = false
}
