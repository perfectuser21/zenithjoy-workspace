package com.zenithjoy.agent.account

/**
 * Sprint 07070917-line02-warmup-keepalive — 养号+验活合一 pass 编排（decision ba59f8b7）。
 *
 * 小号最怕闲置掉线；"切进去做点自然浏览"本身同时【保活+验活】，合成一件事。
 * 本类只做【纯编排】，所有真机 UIA 副作用经 [DouyinUiaOps] 接口注入——
 * [DeviceAccountScanService] 提供真机实现，单测用 fake ops 脱离设备在 JVM 上跑。
 *
 * 编排纪律：
 *   开面板读号列表 → 逐号[切进→刷2-3视频保活→切我页读昵称+粉丝数判活] →
 *   收尾按中台下发 operatorNickname 切操作号（空/空白跳过）。
 * 单号失败/异常隔离：记该号 offline + reason，继续下一号，绝不中断整轮。
 */
class DeviceAccountWarmupPass(
    private val ops: DouyinUiaOps,
    private val videoCountPerAccount: Int = 2,
) {

    suspend fun run(operatorNickname: String?): DeviceAccountModel.WarmupReport {
        val empty = DeviceAccountModel.aggregateWarmupReport(emptyList())
        if (!ops.launchAndSettle()) return empty
        if (!ops.openSwitchAccountPanel()) return empty
        val nicknames = ops.readAccountNicknames() ?: return empty

        val results = nicknames.map { warmupOne(it) }

        // 收尾：中台下发了操作号才切回去（未下发/空白跳过，不崩）。
        if (!operatorNickname.isNullOrBlank()) {
            runCatching { ops.switchToOperator(operatorNickname) }
        }
        ops.forceCloseToHome()
        return DeviceAccountModel.aggregateWarmupReport(results)
    }

    /** 单号养号+验活，全程异常隔离。 */
    private suspend fun warmupOne(nickname: String): DeviceAccountModel.WarmupAccountResult {
        return try {
            if (!ops.switchToAccountByNickname(nickname)) {
                return DeviceAccountModel.WarmupAccountResult(nickname, alive = false, followers = null, reason = "switch_failed")
            }
            // 保活：刷几个视频（纯浏览，不点赞不关注不评论）。
            ops.browseFeed(videoCountPerAccount)
            // 验活：切我页读昵称+粉丝数 + 检测是否撞登录页。
            val profile = ops.readMyProfile()
            val sawLoginPage = ops.sawLoginPage()
            val followers = DeviceAccountModel.parseFollowerCount(profile?.followerText)
            val verdict = DeviceAccountModel.judgeAccountLiveness(
                readNickname = profile?.nickname,
                targetNickname = nickname,
                followerCount = followers,
                sawLoginPage = sawLoginPage,
            )
            DeviceAccountModel.WarmupAccountResult(nickname, verdict.alive, followers, verdict.reason)
        } catch (e: Exception) {
            DeviceAccountModel.WarmupAccountResult(nickname, alive = false, followers = null, reason = "exception")
        }
    }
}

/** 切进某号后我页所读（昵称 + 原始"N粉丝"文本，粉丝文本交给 parseFollowerCount 解析）。 */
data class MyProfile(val nickname: String, val followerText: String?)

/**
 * 养号 pass 需要的真机 UIA 原语。真机实现见 [DeviceAccountScanService]；
 * 抽成接口是为了让编排逻辑（逐号/失败隔离/收尾切号）能用 fake 在 JVM 单测。
 */
interface DouyinUiaOps {
    /** 拉起抖音并顶回主页 feed 沉降（NEW_TASK|CLEAR_TOP）。 */
    suspend fun launchAndSettle(): Boolean
    /** 打开切换账号面板。 */
    suspend fun openSwitchAccountPanel(): Boolean
    /** 读面板里本机登录的号昵称列表；读失败返回 null。 */
    suspend fun readAccountNicknames(): List<String>?
    /** 从当前态导航到面板并切进指定昵称的号（自带开面板）；失败返回 false。 */
    suspend fun switchToAccountByNickname(nickname: String): Boolean
    /** 主页 feed 刷 videoCount 个视频（坐标上滑，每个停留 3-5s，纯浏览）。 */
    suspend fun browseFeed(videoCount: Int)
    /** 切"我"页读昵称 + "N粉丝"文本；读不到我页返回 null。 */
    suspend fun readMyProfile(): MyProfile?
    /** 当前是否撞上登录/注册页（掉线铁证之一）。 */
    suspend fun sawLoginPage(): Boolean
    /** 收尾切到中台指定操作号。 */
    suspend fun switchToOperator(nickname: String): Boolean
    /** 兜底回主页，不留半开状态。 */
    fun forceCloseToHome()
}
