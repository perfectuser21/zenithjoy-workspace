package com.zenithjoy.agent.collect

/**
 * Sprint 07052218 — 私信触达无障碍操作"点击后必须重新抓取快照"纪律。
 * 复用 PR #1119/#1120 DouyinCollectService 已验证过的真机根因修复模式：
 * 点击前的旧 root 快照跳转后不可复用，每次点击操作后必须重新抓取。
 *
 * 用可测的整型 token（抓取计数器/快照序号）建模该规则，不依赖真实
 * AccessibilityNodeInfo（本项目单测无 Robolectric/mockk，仅能测纯函数）。
 */
object SnapshotDiscipline {

    /**
     * 判定"点击后是否确实重新抓取过快照"：点击后的抓取计数必须严格大于点击前。
     */
    fun wasRefetchedAfterClick(fetchCountBeforeClick: Int, fetchCountAfterClick: Int): Boolean {
        return fetchCountAfterClick > fetchCountBeforeClick
    }

    /**
     * 生成下一个快照 token（每次点击操作后调用一次，token 单调递增）。
     */
    fun nextFetchToken(previousToken: Int): Int {
        return previousToken + 1
    }

    /**
     * 断言快照 token 已经在点击后推进；未推进（复用旧快照）则抛异常，禁止静默往下走。
     */
    fun requireFresh(previousToken: Int, currentToken: Int) {
        check(currentToken > previousToken) {
            "SnapshotDiscipline violation: 快照 token 未推进 (previous=$previousToken, current=$currentToken)，" +
                "禁止复用点击前的旧快照，必须重新抓取"
        }
    }
}
