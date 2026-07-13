package com.zenithjoy.agent

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper

/**
 * MediaProjectionHolder — 进程内单例，持有一次性系统截屏授权并按生命周期状态机换出实例。
 *
 * 真机 Android 14 bug（logcat 实锤）：
 *   ScreenCaptureReal: captureOnce failed: Don't re-use the resultData to retrieve the same
 *   projection instance, and don't use a token that has timed out
 *   MediaProjectionHolder: MediaProjection stopped — clearing cached authorization
 *
 * 根因：resultCode/data 只能换取一次 MediaProjection 实例（A14 强约束）。旧实现在 projection
 * 为 null 但 resultCode/data 仍在时会**再次** getMediaProjection → reuse 崩溃。
 *
 * 修复：授权生命周期交给纯状态机 [MediaProjectionAuthState] 管：
 *   - 一份同意（onConsent）只允许 mint 一次（shouldMint 仅 AUTHORIZED 为 true）；
 *   - 实例被 stop → onStopped 丢弃同意凭据进 REVOKED，此后绝不再拿旧 resultData 重换，
 *     只能等 MainActivity 重新弹授权框（hasAuthorization()==false 触发）。
 *
 * 换出后的 MediaProjection 实例本身可反复用于多次 createVirtualDisplay()（release
 * VirtualDisplay ≠ stop MediaProjection），见 ScreenCaptureReal。
 */
object MediaProjectionHolder {
    private const val TAG = "MediaProjectionHolder"

    /** 实际调 getMediaProjection 的动作抽成可注入 lambda（默认走系统 Manager），便于测试不依赖 Android。 */
    fun interface Minter {
        fun mint(context: Context, resultCode: Int, data: Intent): MediaProjection?
    }

    private val defaultMinter = Minter { context, rc, d ->
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            ?: return@Minter null
        try {
            manager.getMediaProjection(rc, d)
        } catch (e: Exception) {
            logW("getMediaProjection failed: ${e.message}")
            null
        }
    }

    @Volatile private var minter: Minter = defaultMinter
    private val authState = MediaProjectionAuthState()
    @Volatile private var resultCode: Int? = null
    @Volatile private var data: Intent? = null
    @Volatile private var projection: MediaProjection? = null

    /** 测试注入用：替换真正换实例的动作。 */
    @Synchronized
    fun setMinterForTest(m: Minter) {
        minter = m
    }

    /** MainActivity 拿到系统截屏授权结果后调用，缓存待 AgentService 换取实例。 */
    @Synchronized
    fun cacheAuthorization(resultCode: Int, data: Intent) {
        this.resultCode = resultCode
        this.data = data
        // 丢弃旧实例引用（不 stop，交给系统），进入 AUTHORIZED，允许换一次新实例
        projection = null
        authState.onConsent()
    }

    /** 状态自检：是否持有可用授权（LIVE 或 AUTHORIZED）。供 AgentService FGS 类型与 MainActivity 横幅判断。 */
    fun hasAuthorization(): Boolean = authState.hasUsableAuthorization()

    /** 状态自检：MediaProjection 实例是否已换出并仍存活。 */
    fun hasLiveProjection(): Boolean = projection != null

    /**
     * 换出（或复用已换出的）MediaProjection 实例。
     * 关键：**绝不在非 shouldMint 时调 getMediaProjection**（杜绝拿一次性 resultData 重换的 A14 崩溃）。
     * @return null 表示无可用授权 / 已 REVOKED 需重新授权 / 换取失败（上层回退到"截图未授权"提示）
     */
    @Synchronized
    fun getOrCreateProjection(context: Context): MediaProjection? {
        // 已有活实例直接复用
        projection?.let { return it }
        // 只有 AUTHORIZED（一份同意的唯一一次机会）才允许换实例
        if (!authState.shouldMint()) {
            return null
        }
        val rc = resultCode ?: return null
        val d = data ?: return null
        val p = minter.mint(context, rc, d) ?: return null
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                logW("MediaProjection stopped — revoking authorization (需重新授权)")
                onProjectionStopped()
            }
        }, Handler(Looper.getMainLooper()))
        projection = p
        authState.onMinted()
        return p
    }

    /** onStop 回调：标 REVOKED + 作废凭据（保证之后 shouldMint 恒 false，不会拿旧 resultData 重换）。 */
    @Synchronized
    private fun onProjectionStopped() {
        authState.onStopped()
        projection = null
        resultCode = null
        data = null
    }

    /** 清空缓存的授权与实例（用户主动重置 License 时调用）。 */
    @Synchronized
    fun clear() {
        try {
            projection?.stop()
        } catch (_: Exception) {
            // 已停止/已失效时 stop() 可能抛异常，忽略
        }
        projection = null
        resultCode = null
        data = null
        authState.onCleared()
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
            // JVM 单测环境下 android.util.Log 未 mock，吞掉
        }
    }
}
