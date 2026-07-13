package com.zenithjoy.agent

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

/**
 * ScreenCaptureService 真实截图实现的 JVM 可测部分。
 *
 * 背景（sprints/07122051-content-judgment-client-wiring 接续刀）：ScreenCaptureService
 * 之前只有 captureImpl 默认桩（永远返回 null），AgentService 生产环境直接用
 * `ScreenCaptureService()` 默认构造，导致 ContentJudgmentService.judge() 每次都在
 * 截图这步短路返回 pending/skipped_capture_failed，/judge-video 请求从未真正发出。
 *
 * VirtualDisplay/ImageReader/MediaProjection 这些 Android SDK 真实调用没法在纯 JVM
 * 单测里跑（真机验证走 xian-rog），但截图流程里两块可以且必须抽成纯函数单测：
 *   1. "非全黑非全零"校验（isBlankImage）—— 防 DRM/SECURE flag 静默黑屏被当成有效截图。
 *   2. 单飞锁 —— 同一时刻只允许一次截图，并发调用互相踩踏会导致 VirtualDisplay/ImageReader
 *      资源竞争崩溃，必须在 ScreenCaptureService 层挡住。
 */
class ScreenCaptureRealTest {

    // ---- isBlankImage 纯函数边界测试 ----

    @Test
    fun `isBlankImage returns true for all-black pixel sample`() {
        val allBlack = IntArray(16) { 0xFF000000.toInt() }
        assertTrue("全黑像素样本应判定为无效截图", ScreenCaptureService.isBlankImage(allBlack))
    }

    @Test
    fun `isBlankImage returns true for all-zero pixel sample`() {
        val allZero = IntArray(16) { 0 }
        assertTrue("全零像素样本应判定为无效截图", ScreenCaptureService.isBlankImage(allZero))
    }

    @Test
    fun `isBlankImage returns true for uniform non-black color`() {
        // DRM/SECURE flag 有些设备返回纯色（非纯黑）占位帧，同样应判定为无效
        val uniformGray = IntArray(16) { 0xFF808080.toInt() }
        assertTrue("单一纯色像素样本应判定为无效截图", ScreenCaptureService.isBlankImage(uniformGray))
    }

    @Test
    fun `isBlankImage returns false for varied pixel sample`() {
        val varied = intArrayOf(0xFF112233.toInt(), 0xFF445566.toInt(), 0xFF778899.toInt(), 0xFFAABBCC.toInt())
        assertFalse("像素有明显差异的正常截图不应判定为无效", ScreenCaptureService.isBlankImage(varied))
    }

    @Test
    fun `isBlankImage returns true for empty pixel sample`() {
        assertTrue("空样本应判定为无效截图（防御式）", ScreenCaptureService.isBlankImage(IntArray(0)))
    }

    // ---- 单飞锁：并发调用只放行一次 ----

    @Test
    fun `captureToBase64 single-flight lock only allows one concurrent capture`() {
        val callCount = AtomicInteger(0)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val service = ScreenCaptureService(captureImpl = {
            callCount.incrementAndGet()
            started.countDown()
            release.await()
            "captured"
        })

        val secondResult: String?
        val t1 = Thread { service.captureToBase64() }
        t1.start()
        started.await()
        // 第一次截图仍在进行中（阻塞在 release.await()），此时并发发起第二次截图请求
        secondResult = service.captureToBase64()
        release.countDown()
        t1.join()

        assertNull("单飞锁挡下时并发第二次调用应立即返回 null，而不是等待或重入", secondResult)
        assertEquals("captureImpl 实际只应被调用一次", 1, callCount.get())
    }

    @Test
    fun `captureToBase64 allows a fresh capture after previous one completes`() {
        val callCount = AtomicInteger(0)
        val service = ScreenCaptureService(captureImpl = {
            callCount.incrementAndGet()
            "captured-$callCount"
        })
        val first = service.captureToBase64()
        val second = service.captureToBase64()
        assertNotNull(first)
        assertNotNull("锁释放后应能发起新的一次截图", second)
        assertEquals(2, callCount.get())
    }
}
