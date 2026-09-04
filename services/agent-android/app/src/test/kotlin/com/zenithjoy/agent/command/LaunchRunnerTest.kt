package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchRunnerTest {
    private val PKG = "com.ss.android.ugc.aweme"
    private val WL = setOf(PKG)

    @Test fun `白名单外拒绝`() = runTest {
        val r = LaunchRunner(WL, { true }, { true }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("com.other").errorCode)
    }

    @Test fun `包不存在回 PACKAGE_NOT_FOUND`() = runTest {
        val r = LaunchRunner(WL, { false }, { true }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_PACKAGE_NOT_FOUND, r.run(PKG).errorCode)
    }

    @Test fun `startLaunch 失败回 LAUNCH_FAILED`() = runTest {
        val r = LaunchRunner(WL, { true }, { false }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_LAUNCH_FAILED, r.run(PKG).errorCode)
    }

    @Test fun `前台轮询到目标包才算成功（判定点：ColorOS静默拦截）`() = runTest {
        var polls = 0
        val r = LaunchRunner(WL, { true }, { true }, { polls++; if (polls >= 3) PKG else "com.launcher" }, sleep = {})
        assertTrue(r.run(PKG).ok)
    }

    @Test fun `超时未到前台回 LAUNCH_NOT_FOREGROUND 且带实际前台`() = runTest {
        val r = LaunchRunner(WL, { true }, { true }, { "com.launcher" }, sleep = {}, timeoutMs = 1_000, pollIntervalMs = 500)
        val o = r.run(PKG)
        assertEquals(CommandProtocol.ERR_LAUNCH_NOT_FOREGROUND, o.errorCode)
        assertEquals("com.launcher", o.data["foreground"])
    }
}
