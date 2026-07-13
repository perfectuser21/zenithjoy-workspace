package com.zenithjoy.agent

/**
 * MediaProjectionAuthState — 屏幕捕获授权生命周期状态机（纯 Kotlin，无任何 Android 类型）。
 *
 * [Red] commit-1 骨架：方法体尚未实现（故意让 MediaProjectionAuthStateTest 失败），
 * 真正的状态机逻辑在 [Green] commit-2 补齐。
 */
class MediaProjectionAuthState {

    enum class State { NO_AUTH, AUTHORIZED, LIVE, REVOKED }

    var state: State = State.NO_AUTH
        private set

    fun onConsent() {
        // TODO commit-2
    }

    fun shouldMint(): Boolean = false // TODO commit-2

    fun onMinted() {
        // TODO commit-2
    }

    fun onStopped() {
        // TODO commit-2
    }

    fun hasUsableAuthorization(): Boolean = false // TODO commit-2
}
