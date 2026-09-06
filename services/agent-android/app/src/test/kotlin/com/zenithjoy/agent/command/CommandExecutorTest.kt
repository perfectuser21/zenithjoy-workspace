package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandExecutorTest {
    @After fun tearDown() = AutomationLease.resetForTest()

    private fun executor(
        remoteEnabled: Boolean = true,
        nativeBusy: Boolean = false,
        nativeBusyProbe: () -> Boolean = { nativeBusy },
        treeDump: () -> Map<String, Any?>? = { mapOf("tree" to "d0 root", "truncated" to false) },
    ) = CommandExecutor(
        remoteControlEnabled = { remoteEnabled },
        nativeBusy = nativeBusyProbe,
        foregroundPkg = { "com.ss.android.ugc.aweme" },
        gesture = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true }),
        screenshot = ScreenshotRunner({ true }, { true }, { "b64" }, { 1080 to 2400 }, sleep = {}),
        type = TypeRunner({ "com.ss.android.ugc.aweme" }, setOf("com.ss.android.ugc.aweme"), { true }),
        launch = LaunchRunner(setOf("com.ss.android.ugc.aweme"), { true }, { true }, { "com.ss.android.ugc.aweme" }, sleep = {}),
        globalAction = { true },
        deviceInfo = { mapOf("model" to "TEST") },
        treeDump = treeDump,
    )

    private fun req(action: CmdAction, args: Map<String, Any?> = emptyMap()) = CmdRequest("m1", action, args)

    @Test fun `远程协助关闭时敏感指令拒绝但 tap 放行`() = runTest {
        val e = executor(remoteEnabled = false)
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.SCREENSHOT))["errorCode"])
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.TYPE, mapOf("text" to "x")))["errorCode"])
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.TREE_DUMP))["errorCode"])
        assertEquals(true, e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))["ok"])
    }

    @Test fun `原生任务在跑时变更类指令回 DEVICE_BUSY_NATIVE 只读类放行`() = runTest {
        val e = executor(nativeBusy = true)
        assertEquals(CommandProtocol.ERR_DEVICE_BUSY_NATIVE, e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))["errorCode"])
        assertEquals(true, e.execute(req(CmdAction.SCREENSHOT))["ok"])
        assertEquals(true, e.execute(req(CmdAction.DEVICE_INFO))["ok"])
    }

    @Test fun `acquire 后原生忙态复查命中回 DEVICE_BUSY_NATIVE 并释放租约`() = runTest {
        // TOCTOU 窗口：首查 false 放行 → tryAcquire 成功 → 原生任务恰好起跑。
        // acquire 后必须复查一次 nativeBusy，命中则让出租约拒单。
        var calls = 0
        val e = executor(nativeBusyProbe = { calls++ >= 1 }) // 第一次 false，第二次起 true
        assertEquals(
            CommandProtocol.ERR_DEVICE_BUSY_NATIVE,
            e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))["errorCode"],
        )
        assertEquals(null, AutomationLease.currentOwner()) // 租约已释放，不锁死原生流程
    }

    @Test fun `变更类指令执行后远程租约被持有`() = runTest {
        val e = executor()
        e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `回执总带 inReplyTo 与前台包名`() = runTest {
        val m = executor().execute(req(CmdAction.DEVICE_INFO))
        assertEquals("m1", m["inReplyTo"])
        assertEquals("com.ss.android.ugc.aweme", m["foregroundPkg"])
    }

    @Test fun `deviceInfo 返回的 callState 字段原样透传`() = runTest {
        val custom = CommandExecutor(
            remoteControlEnabled = { true },
            nativeBusy = { false },
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            gesture = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true }),
            screenshot = ScreenshotRunner({ true }, { true }, { "b64" }, { 1080 to 2400 }, sleep = {}),
            type = TypeRunner({ "com.ss.android.ugc.aweme" }, setOf("com.ss.android.ugc.aweme"), { true }),
            launch = LaunchRunner(setOf("com.ss.android.ugc.aweme"), { true }, { true }, { "com.ss.android.ugc.aweme" }, sleep = {}),
            globalAction = { true },
            deviceInfo = { mapOf("model" to "MAA-AN00", "callState" to "idle") },
            treeDump = { mapOf("tree" to "d0 root", "truncated" to false) },
        )
        val m = custom.execute(req(CmdAction.DEVICE_INFO))
        val data = m["data"] as Map<*, *>
        assertEquals("idle", data["callState"])
    }

    @Test fun `treeDump 为 null 回 TREE_UNAVAILABLE`() = runTest {
        val e = executor(treeDump = { null })
        assertEquals(CommandProtocol.ERR_TREE_UNAVAILABLE, e.execute(req(CmdAction.TREE_DUMP))["errorCode"])
    }

    @Test fun `执行器内部异常转 EXEC_EXCEPTION 不上抛`() = runTest {
        val e = executor(treeDump = { throw IllegalStateException("boom") })
        val m = e.execute(req(CmdAction.TREE_DUMP))
        assertEquals(CommandProtocol.ERR_EXEC_EXCEPTION, m["errorCode"])
        assertTrue((m["data"] as Map<*, *>)["detail"].toString().contains("boom"))
    }
}
