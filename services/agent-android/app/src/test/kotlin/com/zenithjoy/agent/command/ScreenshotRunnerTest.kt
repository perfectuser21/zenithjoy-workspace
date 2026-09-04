package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotRunnerTest {
    @Test fun `未初始化回 NOT_INITIALIZED`() = runTest {
        val r = ScreenshotRunner({ false }, { true }, { "x" }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_NOT_INITIALIZED, r.run().errorCode)
    }

    @Test fun `无授权回 NEED_USER_REAUTH（永久性，上游停止重试）`() = runTest {
        val r = ScreenshotRunner({ true }, { false }, { "x" }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_NEED_USER_REAUTH, r.run().errorCode)
    }

    @Test fun `撞锁重试3次仍 null 回 CAPTURE_FAILED`() = runTest {
        var calls = 0
        val r = ScreenshotRunner({ true }, { true }, { calls++; null }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_CAPTURE_FAILED, r.run().errorCode)
        assertEquals(3, calls)
    }

    @Test fun `第二次重试成功且回执带双分辨率`() = runTest {
        var calls = 0
        val r = ScreenshotRunner({ true }, { true }, { calls++; if (calls >= 2) "b64data" else null }, { 1080 to 2400 }, sleep = {})
        val o = r.run()
        assertTrue(o.ok)
        assertEquals("b64data", o.data["imageBase64"])
        assertEquals(1080, o.data["screenWidth"]); assertEquals(2400, o.data["screenHeight"])
        assertEquals(324, o.data["captureWidth"]); assertEquals(720, o.data["captureHeight"])
    }

    @Test fun `computeCaptureDims 长边不超720不缩`() {
        assertEquals(600 to 700, ScreenshotRunner.computeCaptureDims(600, 700))
        assertEquals(324 to 720, ScreenshotRunner.computeCaptureDims(1080, 2400))
    }
}
