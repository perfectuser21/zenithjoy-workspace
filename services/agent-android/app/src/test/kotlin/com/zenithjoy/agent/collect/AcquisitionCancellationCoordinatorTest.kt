package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AcquisitionCancellationCoordinatorTest {
    @Test fun `safe exit happens before cancelled report`() {
        val calls = mutableListOf<String>()
        val coordinator = AcquisitionCancellationCoordinator(
            safeExit = { calls += "safe_exit"; true },
            reportCancel = { calls += "report"; CollectReporter.ReportResult(true, null) },
        )
        coordinator.cancel("task-1")
        assertEquals(listOf("safe_exit", "report"), calls)
    }

    @Test fun `failed safe exit never reports cancelled`() {
        val coordinator = AcquisitionCancellationCoordinator(
            safeExit = { false },
            reportCancel = { error("must not report") },
        )
        assertNull(coordinator.cancel("task-1"))
    }
}
