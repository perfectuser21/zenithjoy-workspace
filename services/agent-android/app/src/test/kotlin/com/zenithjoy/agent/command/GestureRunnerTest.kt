package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureRunnerTest {
    private val pts = listOf(100f to 200f)

    @Test fun `onCompleted 回调为成功`() = runTest {
        val r = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true })
        assertTrue(r.run(pts, 50).ok)
    }

    @Test fun `onCancelled 回调为 GESTURE_CANCELLED`() = runTest {
        val r = GestureRunner(dispatch = { _, _, onResult -> onResult(false); true })
        assertEquals(CommandProtocol.ERR_GESTURE_CANCELLED, r.run(pts, 50).errorCode)
    }

    @Test fun `dispatch 返回 false 为 SERVICE_NOT_READY`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> false })
        assertEquals(CommandProtocol.ERR_SERVICE_NOT_READY, r.run(pts, 50).errorCode)
    }

    @Test fun `回调不来超时为 GESTURE_TIMEOUT`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> true }, timeoutMs = 10)
        assertEquals(CommandProtocol.ERR_GESTURE_TIMEOUT, r.run(pts, 50).errorCode)
    }

    @Test fun `dispatch 抛异常为 EXEC_EXCEPTION`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> throw IllegalStateException("boom") })
        assertEquals(CommandProtocol.ERR_EXEC_EXCEPTION, r.run(pts, 50).errorCode)
    }
}
