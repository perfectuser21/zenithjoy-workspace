package com.zenithjoy.agent.uia

/**
 * 等节点期间主动消掉厂商插屏 —— 私信剩下 40% 失败的最后一块。
 *
 * 0821 真机现场（#1689 上线后第一次直接从正表读出根因，没连手机）：
 *   NO_SEARCH_INPUT | 前台=com.hihonor.systemmanager
 *   A3-diag: 搜索入口等待超时 failure=WRONG_FOREGROUND attempts=24
 *
 * 缺口很具体：[AccessibilityService.awaitAppForeground]（前台闸）会主动消插屏，
 * 但 [AccessibilityService.awaitNode]（等节点）**只轮询、不消除**——它顺手记下
 * 前台是谁，然后干等满 24 轮。荣耀系统管家的广告盖上来时没人按掉它。
 *
 * **加长等待救不了这一类**：前台已经不是目标 App 了，等多久都等不出那个节点。
 * 该做的是把盖在上面的东西消掉，让目标页面重新露出来。
 */
object InterloperDismiss {
    /**
     * 单次等待里最多消几次插屏。
     *
     * **必须有上限**：厂商插屏可能被消掉又弹出来，无限对拉会把 dm 单条 lead 的
     * 90 秒熔断耗光，最后连有用的错误码都拿不到。宁可这一轮失败并留下现场，
     * 也不要卡死在对拉里。
     */
    const val MAX_DISMISS_PER_WAIT = 2
}

/**
 * 等节点的过程中，该不该顺手消一下前台的插屏。
 *
 * 判定本身完全复用 [NodeAwait.decideGateAction]（前台闸用的同一套），
 * 只多一条：**[targetPkg] 为 null 表示调用方没声明期望前台 → 一律不动作**。
 * 这条是给老调用点兜底的——它们没有期望包名，行为必须一字不变。
 */
fun decideInterloperAction(
    currentPkg: String?,
    selfPkg: String,
    targetPkg: String?,
    hasDismissTarget: Boolean,
    blindRounds: Int,
): GateAction {
    if (targetPkg == null) return GateAction.WAIT
    return NodeAwait.decideGateAction(
        currentPkg = currentPkg,
        selfPkg = selfPkg,
        targetPkg = targetPkg,
        hasDismissTarget = hasDismissTarget,
        blindRounds = blindRounds,
    )
}
