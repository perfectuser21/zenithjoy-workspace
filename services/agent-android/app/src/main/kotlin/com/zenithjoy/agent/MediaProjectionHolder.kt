package com.zenithjoy.agent

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper

/**
 * MediaProjectionHolder — 进程内单例，持有一次性系统截屏授权结果。
 *
 * 设计（sprints/07122051-content-judgment-client-wiring Golden Path 第 1 步）：
 *   1. MainActivity 弹 MediaProjectionManager.createScreenCaptureIntent() 系统授权框，
 *      拿到 resultCode + data 后调 cacheAuthorization() 缓存。
 *   2. AgentService 启动/需要截图时调 getOrCreateProjection() 换出真实 MediaProjection
 *      实例（懒创建，一次授权可反复用于多次截图，直到用户撤销或系统回收）。
 *   3. MediaProjection.Callback.onStop() 触发时（用户在系统通知里点了"停止投屏"，
 *      或系统主动回收）清空缓存，下次 MainActivity 会自动重新弹一次授权框
 *      （通过 hasAuthorization() 判定）。
 *
 * 注意：resultCode/data 只能被消费一次换取 MediaProjection 实例（Android API 约束），
 * 换出后的 MediaProjection 实例本身可反复使用于多次 createVirtualDisplay()。
 */
object MediaProjectionHolder {
    private const val TAG = "MediaProjectionHolder"

    @Volatile private var resultCode: Int? = null
    @Volatile private var data: Intent? = null
    @Volatile private var projection: MediaProjection? = null

    /** MainActivity 拿到系统截屏授权结果后调用，缓存待 AgentService 换取实例。 */
    @Synchronized
    fun cacheAuthorization(resultCode: Int, data: Intent) {
        this.resultCode = resultCode
        this.data = data
        // 新授权到来时旧实例（若有）已失效，清空强制下次重新换取
        projection = null
    }

    /** 状态自检用：是否已有可用的授权数据（不代表 MediaProjection 实例已成功换出）。 */
    fun hasAuthorization(): Boolean = resultCode != null && data != null

    /** 状态自检用：MediaProjection 实例是否已成功换出并仍然存活。 */
    fun hasLiveProjection(): Boolean = projection != null

    /**
     * 换出（或复用已换出的）MediaProjection 实例。
     * @return null 表示尚未授权，或换取失败（调用方应回退到"截图未授权"状态提示）
     */
    @Synchronized
    fun getOrCreateProjection(context: Context): MediaProjection? {
        projection?.let { return it }
        val rc = resultCode ?: return null
        val d = data ?: return null
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            ?: return null
        val p = try {
            manager.getMediaProjection(rc, d)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "getMediaProjection failed: ${e.message}")
            null
        } ?: return null
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                android.util.Log.w(TAG, "MediaProjection stopped — clearing cached authorization")
                clear()
            }
        }, Handler(Looper.getMainLooper()))
        projection = p
        return p
    }

    /** 清空缓存的授权与实例（onStop 回调或用户主动重置 License 时调用）。 */
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
    }
}
