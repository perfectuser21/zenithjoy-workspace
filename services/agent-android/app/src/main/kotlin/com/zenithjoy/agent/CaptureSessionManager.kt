package com.zenithjoy.agent

/**
 * CaptureSessionManager — 按 projection 生命周期持有唯一截图会话（纯逻辑，JVM 可测）。
 *
 * 真机根因(Android 14)：同一 MediaProjection 实例上多次 createVirtualDisplay 会崩
 * （"Don't take multiple captures by invoking createVirtualDisplay multiple times on the
 * same instance"）并把 projection stop 掉。修复纪律：VirtualDisplay/ImageReader 按
 * projection 只建一次、常驻复用，projection 变了(重新授权换出新实例)或显式 release 才拆。
 *
 * 本管理器不碰 Android SDK：会话对象 S 由外部工厂创建/释放（生产环境 S 内含
 * VirtualDisplay + ImageReader，见 ScreenCaptureReal）。以 projection **引用同一性**
 * (===) 判断是否换了实例。
 *
 * @param factory 用给定 projection token 建一个会话；返回 null 表示建失败（不缓存，下次重试）。
 * @param releaser 拆一个会话（释放其 VirtualDisplay/ImageReader）。
 */
class CaptureSessionManager<S : Any>(
    private val factory: (projectionToken: Any) -> S?,
    private val releaser: (S) -> Unit,
) {
    private var token: Any? = null
    private var session: S? = null

    /** 取当前 projection 的会话：同一 projection 复用；换了则释放旧的再建新的。 */
    @Synchronized
    fun sessionFor(projectionToken: Any): S? {
        val existing = session
        if (existing != null && token === projectionToken) return existing
        // projection 变了或还没会话 → 拆旧建新
        existing?.let { releaser(it) }
        session = null
        token = null
        val fresh = factory(projectionToken) ?: return null
        session = fresh
        token = projectionToken
        return fresh
    }

    /** 拆当前会话（projection 停止 / 用户重置授权时调）。 */
    @Synchronized
    fun release() {
        session?.let { releaser(it) }
        session = null
        token = null
    }
}
