package com.zenithjoy.agent.account

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Judge 复核发现的缺陷 B（阻塞）：`DeviceAccountScanService.startScan` 里的超时兜底清理
 * （`state = State.IDLE` / `ScanMutex.busy = false`）此前直接写在 `withTimeoutOrNull` 调用
 * 之后，只覆盖了"超时"这一种异常路径。`runScanSequence` 内部的无障碍操作（真机常见
 * IllegalStateException/DeadObjectException 等）一旦抛出非超时异常，会直接穿透整个协程，
 * 清理代码永远不会执行——ScanMutex 永久卡 busy=true（采集/触达功能全部自杀）、state 永久
 * 非 IDLE（后续扫描请求被拒），且切换账号面板可能停留半开状态。
 *
 * `DeviceAccountScanService` 本身是 AccessibilityService，其真实协程调度（scope.launch +
 * Android Log/广播/无障碍节点操作）无法脱离真机/Robolectric 单测；本测试把"无论 block 正常
 * 完成/超时/抛异常，清理逻辑都必须执行"这条契约抽成可测的纯函数
 * [DeviceAccountScanService.runScanWithCleanup]（副作用全部通过参数注入的 lambda 完成，
 * 不触碰任何 Android 框架 API），用 kotlinx-coroutines-test 的 runTest 直接驱动协程异常路径，
 * 从而在不依赖真机的前提下证明 try/finally 结构确实生效。
 */
class DeviceAccountScanServiceCleanupTest {

    @Test
    fun `setIdle runs when block completes normally, no abnormal-exit callback`() = runTest {
        var idleCalled = false
        var abnormalExitCode: String? = null

        DeviceAccountScanService.runScanWithCleanup(
            timeoutMs = 1_000L,
            block = { /* completes immediately */ },
            onAbnormalExit = { abnormalExitCode = it },
            setIdle = { idleCalled = true },
            logWarn = {},
            logError = {},
        )

        assertTrue(idleCalled)
        assertEquals(null, abnormalExitCode)
    }

    @Test
    fun `setIdle runs and SCAN_TIMEOUT is reported when block times out`() = runTest {
        var idleCalled = false
        var abnormalExitCode: String? = null

        DeviceAccountScanService.runScanWithCleanup(
            timeoutMs = 10L,
            block = { delay(10_000L) },
            onAbnormalExit = { abnormalExitCode = it },
            setIdle = { idleCalled = true },
            logWarn = {},
            logError = {},
        )

        assertTrue(idleCalled)
        assertEquals("SCAN_TIMEOUT", abnormalExitCode)
    }

    @Test
    fun `setIdle still runs and SCAN_EXCEPTION is reported when block throws a non-timeout exception`() = runTest {
        var idleCalled = false
        var abnormalExitCode: String? = null

        DeviceAccountScanService.runScanWithCleanup(
            timeoutMs = 1_000L,
            block = { throw IllegalStateException("UIA node vanished mid-scan") },
            onAbnormalExit = { abnormalExitCode = it },
            setIdle = { idleCalled = true },
            logWarn = {},
            logError = {},
        )

        // 修复前：本断言会失败——异常从 runScanWithCleanup 穿透出去，setIdle 永远不会跑，
        // ScanMutex/state 永久卡死。
        assertTrue("setIdle must run even when block throws a non-timeout exception", idleCalled)
        assertEquals("SCAN_EXCEPTION", abnormalExitCode)
    }

    @Test
    fun `CancellationException is rethrown, not swallowed as a scan failure, but setIdle still runs`() = runTest {
        var idleCalled = false
        var abnormalExitCode: String? = null

        try {
            DeviceAccountScanService.runScanWithCleanup(
                timeoutMs = 1_000L,
                block = { throw CancellationException("scope cancelled — e.g. onDestroy") },
                onAbnormalExit = { abnormalExitCode = it },
                setIdle = { idleCalled = true },
                logWarn = {},
                logError = {},
            )
            fail("CancellationException must propagate out of runScanWithCleanup, not be swallowed")
        } catch (e: CancellationException) {
            // 预期：结构化并发的取消信号必须重新抛出，不能被当成 SCAN_EXCEPTION 吞掉，
            // 否则会破坏父协程的取消传播语义。
        }

        // finally 块必须仍然执行，清理 ScanMutex/state，不因为异常类型而跳过。
        assertTrue("setIdle must still run even when the block is cancelled", idleCalled)
        // 取消不是"扫描失败"，不应触发 onAbnormalExit（不强制关闭面板/不广播失败结果）。
        assertEquals(null, abnormalExitCode)
    }

    @Test
    fun `onAbnormalExit is not invoked when block completes normally`() = runTest {
        var abnormalExitInvoked = false

        DeviceAccountScanService.runScanWithCleanup(
            timeoutMs = 1_000L,
            block = { },
            onAbnormalExit = { abnormalExitInvoked = true },
            setIdle = { },
            logWarn = {},
            logError = {},
        )

        assertFalse(abnormalExitInvoked)
    }
}
