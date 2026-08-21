package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 私信链 NO_SEARCH_INPUT 被"修好又复发"四次的回归守卫。
 *
 * 真机 0821 实测（小粉 ANY-AN00，两次失败诊断一字不差）：
 *   A3-diag: NO_SEARCH_INPUT searchBtnFound=true failure=WRONG_FOREGROUND
 *            attempts=12 waitedMs=5500 fallbackEditTextAlsoMissing=true
 *
 * 拆开看：抖音到前台了（第一道闸过了）、搜索按钮也找到了，点完之后等输入框的
 * 那 5.5 秒里**前台又不是抖音了**。同机实时录制（逐 0.5s 采样）显示抖音冷启动
 * 闪屏要 10 秒，而这里只等 6 秒。
 *
 * 前四次修复（#1120/#1375/#1640/#1651-1655）改的都是"等得更久 / 等得更准"，
 * 没有一次处理"等的过程中前台被别人抢走"——所以换个抢焦点的 ROM 组件就复发。
 * 本函数把"该判死还是该重新拉起再试"变成可测的纯决策，不再靠调等待时长赌。
 */
class ForegroundRecoveryTest {

    @Test
    fun `前台被抢走且还有重试额度时应重新拉起再试`() {
        assertEquals(
            RecoveryAction.RELAUNCH_RETRY,
            decideRecovery(WaitFailure.WRONG_FOREGROUND, retriesUsed = 0, maxRetries = 1),
        )
    }

    @Test
    fun `压根没有窗口时也应重新拉起再试`() {
        assertEquals(
            RecoveryAction.RELAUNCH_RETRY,
            decideRecovery(WaitFailure.NO_ROOT, retriesUsed = 0, maxRetries = 1),
        )
    }

    @Test
    fun `前台是对的但元素确实不在时直接判死——重试无益，别浪费真机时间`() {
        assertEquals(
            RecoveryAction.FAIL,
            decideRecovery(WaitFailure.TARGET_ABSENT, retriesUsed = 0, maxRetries = 1),
        )
    }

    @Test
    fun `重试额度用完后即使前台被抢也必须判死——防止无限重试拖死 90 秒熔断`() {
        assertEquals(
            RecoveryAction.FAIL,
            decideRecovery(WaitFailure.WRONG_FOREGROUND, retriesUsed = 1, maxRetries = 1),
        )
    }
}
