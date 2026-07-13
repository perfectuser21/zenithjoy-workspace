package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MediaProjectionAuthStateTest — 屏幕捕获授权状态机（纯 Kotlin，无 Android 依赖）单测。
 *
 * 背景（真机 Android 14 bug，logcat 实锤）：
 *   ScreenCaptureReal: captureOnce failed: Don't re-use the resultData to retrieve the same
 *   projection instance, and don't use a token that has timed out
 *   MediaProjectionHolder: MediaProjection stopped — clearing cached authorization
 *
 * 根因：旧 MediaProjectionHolder 把「一次性同意凭据(resultCode/data)」当成「可反复懒换
 * MediaProjection 实例的耐用证书」。Android 14 上 getMediaProjection(rc,data) 的 resultData
 * 一次性——一旦换出的 projection 被 stop（服务重启/系统回收），旧 resultData 作废，
 * 再调 getMediaProjection 抛 "Reusing token: invalid projection"。
 *
 * 本状态机把「一份同意只允许换一次实例」「stop 后必须重新授权」变成不变量，
 * 从结构上杜绝 reuse 崩溃。
 */
class MediaProjectionAuthStateTest {

    @Test
    fun `一份同意只允许 mint 一次 — 首次 shouldMint=true, onMinted 后 shouldMint=false`() {
        val s = MediaProjectionAuthState()
        s.onConsent()
        assertTrue("同意后首次应允许换实例", s.shouldMint())
        s.onMinted()
        assertFalse("已换出实例后同一份同意不得再次 mint", s.shouldMint())
    }

    @Test
    fun `onStopped 后 hasUsableAuthorization=false 且 shouldMint=false — 核心杜绝 reuse`() {
        val s = MediaProjectionAuthState()
        s.onConsent()
        s.onMinted() // LIVE
        s.onStopped() // REVOKED，丢弃同意凭据
        assertFalse("stop 后不应再声称有可用授权", s.hasUsableAuthorization())
        assertFalse("stop 后绝不允许拿旧 resultData 重换实例", s.shouldMint())
    }

    @Test
    fun `REVOKED 后不经 onConsent 无论如何拿不到 mint 许可`() {
        val s = MediaProjectionAuthState()
        s.onConsent()
        s.onMinted()
        s.onStopped() // REVOKED
        // 反复尝试各种非 onConsent 的调用，都不得让 shouldMint 恢复 true
        s.onMinted()
        s.onStopped()
        assertFalse("REVOKED 态不经重新授权不可能变回可 mint", s.shouldMint())
        assertFalse("REVOKED 态不经重新授权不可能声称有可用授权", s.hasUsableAuthorization())
    }

    @Test
    fun `重新 onConsent 后可再 mint — 用户重新授权能恢复`() {
        val s = MediaProjectionAuthState()
        s.onConsent()
        s.onMinted()
        s.onStopped() // REVOKED
        s.onConsent() // 用户重新弹框授权
        assertTrue("重新授权后应恢复可用授权", s.hasUsableAuthorization())
        assertTrue("重新授权后应允许再换一次实例", s.shouldMint())
        s.onMinted()
        assertFalse("重新授权换出后同样一份同意只 mint 一次", s.shouldMint())
    }

    @Test
    fun `初始态 NO_AUTH 既无可用授权也不可 mint`() {
        val s = MediaProjectionAuthState()
        assertFalse(s.hasUsableAuthorization())
        assertFalse(s.shouldMint())
    }

    @Test
    fun `AUTHORIZED 尚未 mint 时 hasUsableAuthorization=true`() {
        val s = MediaProjectionAuthState()
        s.onConsent()
        assertTrue("已同意未换实例也算有可用授权（AgentService FGS/横幅判断依据）", s.hasUsableAuthorization())
    }
}
