package com.zenithjoy.agent.command

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationLeaseTest {
    @After fun tearDown() = AutomationLease.resetForTest()

    @Test fun `acquire 后 currentOwner 可见`() {
        assertTrue(AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE))
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `他人未过期时 acquire 失败`() {
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        assertFalse(AutomationLease.tryAcquire("someone_else"))
    }

    @Test fun `同 owner 重复 acquire 等于续租`() {
        var now = 0L
        AutomationLease.clock = { now }
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        now = AutomationLease.LEASE_MS - 1_000
        assertTrue(AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)) // 续租
        now = AutomationLease.LEASE_MS + 1_000 // 距首次已超期，但续租过所以仍有效
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `过期后自动可被抢占且 currentOwner 为 null`() {
        var now = 0L
        AutomationLease.clock = { now }
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        now = AutomationLease.LEASE_MS + 1
        assertNull(AutomationLease.currentOwner())
        assertTrue(AutomationLease.tryAcquire("someone_else"))
    }

    @Test fun `release 只清自己的锁`() {
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        AutomationLease.release("someone_else") // 不是 owner，无效
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
        AutomationLease.release(AutomationLease.OWNER_REMOTE)
        assertNull(AutomationLease.currentOwner())
    }

    @Test fun `isHeldByOther 判定`() {
        assertFalse(AutomationLease.isHeldByOther(AutomationLease.OWNER_NATIVE))
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        assertTrue(AutomationLease.isHeldByOther(AutomationLease.OWNER_NATIVE))
        assertFalse(AutomationLease.isHeldByOther(AutomationLease.OWNER_REMOTE))
    }
}
