package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * 真机根因(Android 14, logcat 实锤)：
 *   ScreenCaptureReal: captureOnce failed: ... Don't take multiple captures by invoking
 *   MediaProjection#createVirtualDisplay multiple times on the same instance.
 *   MediaProjectionHolder: MediaProjection stopped — revoking authorization
 *
 * 旧实现每次截图都 projection.createVirtualDisplay()，A14 第二次即崩 + projection 被 stop
 * → 之后全部判定截图 no MediaProjection instance → judgment_status 恒 pending。
 *
 * 修复：VirtualDisplay/ImageReader 按 projection 只建一次、常驻复用（本管理器守住该纪律）。
 * 本测试用不透明 token 代替 Android 的 MediaProjection，纯 JVM 验证复用/重建/释放语义。
 */
class CaptureSessionManagerTest {

    private class FakeSession(val id: Int) {
        var released = false
    }

    // 同一 projection 多次取会话 → 工厂只建一次（=createVirtualDisplay 只调一次，满足 A14）
    @Test fun `same projection reuses one session across N captures`() {
        var created = 0
        val mgr = CaptureSessionManager<FakeSession>(
            factory = { FakeSession(++created) },
            releaser = { it.released = true },
        )
        val proj = Any()
        val s1 = mgr.sessionFor(proj)
        val s2 = mgr.sessionFor(proj)
        val s3 = mgr.sessionFor(proj)
        assertEquals("同一 projection 只应建一次会话", 1, created)
        assertSame(s1, s2)
        assertSame(s2, s3)
    }

    // projection 变了(重新授权换出新实例) → 释放旧会话 + 重建
    @Test fun `projection change releases old session and rebuilds`() {
        var created = 0
        val mgr = CaptureSessionManager<FakeSession>(
            factory = { FakeSession(++created) },
            releaser = { it.released = true },
        )
        val projA = Any()
        val projB = Any()
        val a = mgr.sessionFor(projA)!!
        val b = mgr.sessionFor(projB)!!
        assertEquals(2, created)
        assertEquals("换 projection 时旧会话必须释放", true, a.released)
        assertEquals(false, b.released)
    }

    // 显式 release → 释放当前会话，下次取会重建
    @Test fun `release tears down current session`() {
        var created = 0
        val mgr = CaptureSessionManager<FakeSession>(
            factory = { FakeSession(++created) },
            releaser = { it.released = true },
        )
        val proj = Any()
        val a = mgr.sessionFor(proj)!!
        mgr.release()
        assertEquals("release 后旧会话必须释放", true, a.released)
        val b = mgr.sessionFor(proj)!!
        assertEquals("release 后同 projection 也应重建", 2, created)
        assertEquals(false, b.released)
    }

    // 工厂返回 null(创建失败) → 不缓存，下次仍尝试
    @Test fun `null session from factory is not cached`() {
        var created = 0
        val mgr = CaptureSessionManager<FakeSession>(
            factory = { created++; null },
            releaser = { it.released = true },
        )
        val proj = Any()
        assertNull(mgr.sessionFor(proj))
        assertNull(mgr.sessionFor(proj))
        assertEquals("失败不缓存,每次都应重试", 2, created)
    }
}
