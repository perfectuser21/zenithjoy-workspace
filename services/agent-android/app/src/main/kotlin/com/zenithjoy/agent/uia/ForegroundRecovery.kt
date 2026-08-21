package com.zenithjoy.agent.uia

/**
 * 等待失败之后该怎么办 —— 把"判死还是重来"从散落的 if 里抽成可测的纯决策。
 *
 * 为什么需要它（NO_SEARCH_INPUT 复发五次的账）：
 * 前四次修复（#1120/#1375/#1640/#1651-1655）改的都是"等得更久 / 等得更准"——
 * 换选择器、加轮询、分档位。但这些全都建立在同一个隐含前提上：**等的过程中，
 * 我们要找的那个页面一直在前台**。真机 0821 实测推翻了这个前提：
 *
 *   A3-diag: NO_SEARCH_INPUT searchBtnFound=true failure=WRONG_FOREGROUND
 *
 * 搜索按钮找到了、点了，然后在等输入框的 5.5 秒里前台被别的东西抢走了
 * （荣耀系统管家开屏广告、全局搜索、或抖音自己还没走出 10 秒闪屏）。
 * 这种情况下再怎么加长等待都没用——**前台已经不是我们要的页面了，
 * 等到天荒地老也等不出那个输入框。** 正确动作是重新把目标应用拉回前台再试一次。
 *
 * 反过来，前台是对的、元素确实不在（TARGET_ABSENT），重试就是纯浪费真机时间，
 * 该判死就判死。区分这两种失败正是本函数存在的意义。
 */
enum class RecoveryAction {
    /** 判死：上报错误码，结束本次处理 */
    FAIL,

    /** 重新把目标应用拉回前台，再试一次 */
    RELAUNCH_RETRY,
}

/**
 * @param failure   本次等待失败的分类（来自 [NodeAwait.classifyFailure]）
 * @param retriesUsed 已经重试过几次
 * @param maxRetries  最多允许重试几次。**必须有上限**：dm 单条 lead 有 90 秒熔断，
 *                    无限重试只会把熔断耗光，反而拿不到有用的错误码。
 */
fun decideRecovery(
    failure: WaitFailure,
    retriesUsed: Int,
    maxRetries: Int = 1,
): RecoveryAction {
    if (retriesUsed >= maxRetries) return RecoveryAction.FAIL
    return when (failure) {
        // 前台被抢走 / 压根没有窗口 —— 重新拉起有意义
        WaitFailure.WRONG_FOREGROUND, WaitFailure.NO_ROOT -> RecoveryAction.RELAUNCH_RETRY
        // 前台是对的，元素确实不在 —— 重试无益
        WaitFailure.TARGET_ABSENT -> RecoveryAction.FAIL
    }
}
