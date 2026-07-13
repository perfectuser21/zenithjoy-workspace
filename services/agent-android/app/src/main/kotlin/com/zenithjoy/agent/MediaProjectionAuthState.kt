package com.zenithjoy.agent

/**
 * MediaProjectionAuthState — 屏幕捕获授权生命周期状态机（纯 Kotlin，无任何 Android 类型）。
 *
 * 存在意义（真机 Android 14 bug 根因）：Android 14 上 MediaProjectionManager
 * .getMediaProjection(resultCode, resultData) 的 resultData 是**一次性**的——
 * 换出的 MediaProjection 一旦被 stop（服务重启/系统回收/用户点停止投屏），旧 resultData 作废，
 * 再拿它调 getMediaProjection 会抛 "Don't re-use the resultData ... token that has timed out"。
 *
 * 旧 MediaProjectionHolder 把「同意凭据」当成「可反复懒换实例的耐用证书」：projection 为 null 但
 * resultCode/data 仍在时会重新 getMediaProjection → 正是这个 reuse 崩溃。
 *
 * 本状态机把两条不变量固化进类型：
 *   1. **一份同意只允许换一次实例**（shouldMint 仅在 AUTHORIZED 返回 true，onMinted 后转 LIVE）。
 *   2. **实例一旦 stop 就必须重新授权**（onStopped 丢弃同意凭据，进 REVOKED；
 *      REVOKED 不经 onConsent 永远无法回到能 mint 的状态 → 杜绝拿旧 resultData 重换）。
 *
 * 状态：
 *   NO_AUTH    无授权（初始态 / clear 后）
 *   AUTHORIZED 有同意凭据、尚未换实例（可 mint 一次）
 *   LIVE       已换出实例、存活（不可再 mint）
 *   REVOKED    曾 LIVE 但被 stop，同意凭据已作废，需重新授权
 */
class MediaProjectionAuthState {

    enum class State { NO_AUTH, AUTHORIZED, LIVE, REVOKED }

    var state: State = State.NO_AUTH
        private set

    /** 用户完成一次系统截屏授权（或重新授权），进入可 mint 一次的 AUTHORIZED（覆盖旧态）。 */
    fun onConsent() {
        state = State.AUTHORIZED
    }

    /** 是否允许换一次 MediaProjection 实例：仅当 AUTHORIZED（一份同意只会 true 一次）。 */
    fun shouldMint(): Boolean = state == State.AUTHORIZED

    /** 成功换出实例后调用：AUTHORIZED → LIVE（此后 shouldMint 恒 false，直到重新 onConsent）。 */
    fun onMinted() {
        if (state == State.AUTHORIZED) {
            state = State.LIVE
        }
    }

    /**
     * MediaProjection 被 stop（onStop 回调 / 系统回收）时调用：LIVE → REVOKED，并作废同意凭据。
     * 从任何非 NO_AUTH 态收到 stop 都视为授权失效进 REVOKED；NO_AUTH 无需变化。
     * REVOKED 不经 onConsent 无论如何拿不到 mint 许可（防 reuse 旧 resultData）。
     */
    fun onStopped() {
        if (state != State.NO_AUTH) {
            state = State.REVOKED
        }
    }

    /**
     * 是否持有可用授权（供 AgentService FGS 类型判断 / MainActivity 横幅判断）。
     * LIVE 或 AUTHORIZED 为 true；REVOKED / NO_AUTH 为 false（提示需重新弹授权框）。
     */
    fun hasUsableAuthorization(): Boolean =
        state == State.LIVE || state == State.AUTHORIZED

    /** 用户主动重置 License（clear）时回到初始 NO_AUTH。 */
    fun onCleared() {
        state = State.NO_AUTH
    }
}
