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
        treeDump: () -> Map<String, Any?>? = { mapOf("tree" to "d0 root", "truncated" to false) },
    ) = CommandExecutor(
        remoteControlEnabled = { remoteEnabled },
        nativeBusy = { nativeBusy },
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
