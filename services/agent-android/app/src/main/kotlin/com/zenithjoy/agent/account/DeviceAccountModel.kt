package com.zenithjoy.agent.account

/**
 * Sprint 07061204 — 安卓设备账号模型：账号扫描判定纯函数集合。
 *
 * 全部函数无 Android 框架依赖（无 AccessibilityNodeInfo/Context/DB），可脱离设备用 JUnit 在 JVM 上跑。
 * 覆盖 Golden Path Step 1-7：全局互斥锁判定 / 扫描数据保鲜 / 单次扫描去重 / tenant_id 绑定隔离 /
 * 双端登录冲突覆盖判定（含标失效+写告警）/ 下线判定 / 派发时重扫触发。
 *
 * 契约来源：sprints/07061204-android-device-account-model/contract-draft.md
 */
object DeviceAccountModel {

    // ── Step 3: dedupeSameDeviceAccounts ────────────────────────────────────
    /**
     * 单次扫描内账号去重，保持首次出现顺序。
     */
    fun dedupeSameDeviceAccounts(scannedDouyinIds: List<String>): List<String> {
        return scannedDouyinIds.distinct()
    }

    // ── Step 5: resolveDeviceConflict（双端登录冲突覆盖判定，以后上报者为准）─────
    /**
     * 双端冲突覆盖判定结果。
     * - NO_CONFLICT：未绑定过 or 同设备重复上报，非冲突
     * - OVERWRITE_EXISTING：不同设备且新上报时间戳不早于旧记录，以后上报者为准覆盖
     * - KEEP_EXISTING_STALE_REPORT：不同设备但新上报是网络延迟导致的过期消息，丢弃不覆盖
     */
    enum class ConflictResolution { NO_CONFLICT, OVERWRITE_EXISTING, KEEP_EXISTING_STALE_REPORT }

    /**
     * @param existingDeviceId 该账号此前已绑定的设备 id（null = 未绑定过）
     * @param existingScanAtMs 旧绑定记录的扫描时间戳（由中台接收扫描请求时打时间戳，非设备本地时间；
     *                          Generator 调用方实现时必须传入服务端时间，避免设备间 clock skew 导致误判——见风险登记 #1）
     * @param newDeviceId 本次上报的设备 id
     * @param newScanAtMs 本次上报的扫描时间戳（同上，服务端时间）
     */
    fun resolveDeviceConflict(
        existingDeviceId: String?,
        existingScanAtMs: Long?,
        newDeviceId: String,
        newScanAtMs: Long,
    ): ConflictResolution {
        if (existingDeviceId == null) {
            return ConflictResolution.NO_CONFLICT
        }
        if (existingDeviceId == newDeviceId) {
            return ConflictResolution.NO_CONFLICT
        }
        // existingScanAtMs 理论上不应为 null（既有绑定必有扫描时间），此处按"最旧"兜底防御性处理
        val existingTs = existingScanAtMs ?: Long.MIN_VALUE
        return if (newScanAtMs >= existingTs) {
            ConflictResolution.OVERWRITE_EXISTING
        } else {
            ConflictResolution.KEEP_EXISTING_STALE_REPORT
        }
    }

    /**
     * 仅 OVERWRITE_EXISTING 应把旧设备记录标为失效（Golden Path Step 5 后半句）。
     * 调用方拿到 true 后必须真正执行 DB 标失效写操作（本函数只判定"该不该做"，不执行副作用）。
     */
    fun shouldInvalidateOldDeviceRecord(resolution: ConflictResolution): Boolean {
        return resolution == ConflictResolution.OVERWRITE_EXISTING
    }

    /**
     * 仅 OVERWRITE_EXISTING 应写日志告警（Golden Path Step 5 后半句）。
     * 调用方拿到 true 后必须真正执行日志告警写操作（本函数只判定"该不该做"，不执行副作用）。
     */
    fun shouldLogConflictAlert(resolution: ConflictResolution): Boolean {
        return resolution == ConflictResolution.OVERWRITE_EXISTING
    }

    // ── Step 4: filterAccountsByTenant（tenant_id 绑定隔离）────────────────────
    /**
     * 单次扫描到的账号记录。
     *
     * ⚠️ tenantId 来源约束（接缝清单第 4 条）：本函数只做过滤，不做来源校验。
     * 真实调用链上 tenantId **不得信任 Android 设备上报值**，必须由服务端按 agent_id 反查得到
     * （对齐"同机双租户 deny"修复的严格程度：设备是不可信输入源，租户边界必须在服务端裁定）。
     * Generator 实现写回 agent_platform_sessions 的调用代码时，必须用 agent-tenant-resolver
     * 等服务端反查结果构造 ScannedAccount，不得直接使用请求体里携带的 tenant_id 字段。
     */
    data class ScannedAccount(
        val douyinId: String,
        val deviceId: String,
        val tenantId: String,
        val scanAtMs: Long,
    )

    /**
     * 只返回目标 tenant_id 的账号记录，不同 tenant_id 的记录绝不出现在结果中（Invariant 租户隔离铁律）。
     */
    fun filterAccountsByTenant(all: List<ScannedAccount>, tenantId: String): List<ScannedAccount> {
        return all.filter { it.tenantId == tenantId }
    }

    // ── Step 2: resolveScanReadResult（扫描数据保鲜）───────────────────────────
    /** 无障碍服务读取失败/超时 → 保留旧列表标 stale，不用空值覆盖。 */
    enum class ScanReadOutcome { UPDATE_ACTIVE_LIST, KEEP_PREVIOUS_MARK_STALE }

    fun resolveScanReadResult(readSucceeded: Boolean): ScanReadOutcome {
        return if (readSucceeded) ScanReadOutcome.UPDATE_ACTIVE_LIST else ScanReadOutcome.KEEP_PREVIOUS_MARK_STALE
    }

    // ── Step 6: checkAccountOffline（下线判定）─────────────────────────────────
    enum class AccountOfflineStatus { ONLINE, WENT_OFFLINE }

    /**
     * 中台记录的账号 id 仍存在于本次扫描到的当前登录账号列表 → ONLINE；
     * 不存在（或本次扫描登录列表为空）→ WENT_OFFLINE。
     */
    fun checkAccountOffline(recordedDouyinId: String, currentlyLoggedInIds: List<String>): AccountOfflineStatus {
        return if (currentlyLoggedInIds.contains(recordedDouyinId)) {
            AccountOfflineStatus.ONLINE
        } else {
            AccountOfflineStatus.WENT_OFFLINE
        }
    }

    // ── Step 7: evaluateDispatchAccountStatus（派发时发现未登录 → 立即重扫）──────
    enum class DispatchAccountDecision { PROCEED, TRIGGER_RESCAN_AND_FAIL }

    /**
     * 中台记录在线但派发时实际探测未登录（不一致）→ TRIGGER_RESCAN_AND_FAIL：
     *   立即触发一次实时重新扫描更新状态，不等下个周期，该次任务按未登录处理转失败/人工核实。
     * 记录与实际一致，或记录离线但实际在线（数据滞后，非失败性不一致）→ PROCEED。
     */
    fun evaluateDispatchAccountStatus(recordedOnline: Boolean, actualLoggedInAtDispatch: Boolean): DispatchAccountDecision {
        return if (recordedOnline && !actualLoggedInAtDispatch) {
            DispatchAccountDecision.TRIGGER_RESCAN_AND_FAIL
        } else {
            DispatchAccountDecision.PROCEED
        }
    }

    // ── Step 1: shouldSkipScanDueToMutex（全局互斥锁判定）──────────────────────
    /**
     * 扫描前检查全局互斥锁，若采集/触达任务正在跑则本轮跳过，等下一个周期。
     *
     * ⚠️ 本函数只做布尔判定透传，不保证锁的原子获取/释放。三个无障碍服务
     * （切换账号扫描 + 采集 + 触达）共享同一把全局互斥锁时的真实竞态（TOCTOU：
     * 判定时锁未被占用，但判定后、实际开始扫描前的窗口期锁被其他服务抢占）未被本函数覆盖，
     * 是 Generator 集成代码（互斥锁的原子获取/释放实现）的职责——见风险登记 #4。
     */
    fun shouldSkipScanDueToMutex(isCollectOrOutreachRunning: Boolean): Boolean {
        return isCollectOrOutreachRunning
    }

    // ── 养号+验活合一 pass（Sprint 07070917，decision ba59f8b7）──────────────────
    // 小号掉线特征 = 切进去就没了/进不去，不是弹重登页。故验活用"切进去+读只有真登着
    // 才读得到的东西（我页昵称+粉丝数）"反证；读不到/还原成别号/撞登录页 = 掉线。

    /**
     * 解析抖音"我"页"N粉丝"文本为数值。支持纯数字("4768粉丝")、带空格("1196 粉丝")、
     * "万"后缀("1.2万粉丝"→12000、"3万"→30000)；无数字("粉丝")/空/null 返回 null（= 读不到粉丝数，判掉线信号之一）。
     */
    fun parseFollowerCount(text: String?): Long? {
        if (text.isNullOrBlank()) return null
        val m = Regex("([0-9]+(?:\\.[0-9]+)?)\\s*(万)?").find(text) ?: return null
        val num = m.groupValues[1].toDoubleOrNull() ?: return null
        val mult = if (m.groupValues[2] == "万") 10_000.0 else 1.0
        return (num * mult).toLong()
    }

    /** 逐号验活裁决（alive + 稳定 reason key，供上报与告警）。 */
    data class LivenessVerdict(val alive: Boolean, val reason: String)

    /**
     * 综合判活：切进该号后读我页所得。任一"干净在线信号"不满足 = 掉线。
     * 优先级：撞登录注册页 > 我页读不到(昵称 null) > 读不到粉丝数 > 昵称还原成别号 > 在线。
     */
    fun judgeAccountLiveness(
        readNickname: String?,
        targetNickname: String,
        followerCount: Long?,
        sawLoginPage: Boolean,
    ): LivenessVerdict {
        if (sawLoginPage) return LivenessVerdict(false, "login_page")
        if (readNickname == null) return LivenessVerdict(false, "profile_unreadable")
        if (followerCount == null) return LivenessVerdict(false, "no_follower_count")
        if (readNickname != targetNickname) return LivenessVerdict(false, "account_reverted")
        return LivenessVerdict(true, "alive")
    }

    /** 单号养号 pass 结果。 */
    data class WarmupAccountResult(val nickname: String, val alive: Boolean, val followers: Long?, val reason: String)

    /** 整轮养号 pass 汇总（上报中台用）。 */
    data class WarmupReport(val total: Int, val aliveCount: Int, val offlineCount: Int, val results: List<WarmupAccountResult>)

    fun aggregateWarmupReport(results: List<WarmupAccountResult>): WarmupReport {
        val alive = results.count { it.alive }
        return WarmupReport(total = results.size, aliveCount = alive, offlineCount = results.size - alive, results = results)
    }
}
