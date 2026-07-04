package com.zenithjoy.agent

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

object MachineFingerprint {

    /**
     * 计算安卓设备指纹：ANDROID_ID + 型号 → SHA-256 前 32 位 hex。
     * 对齐桌面 agent 的 computeMachineId() 算法风格（同一台机器重启不变）。
     * ANDROID_ID 在恢复出厂设置后会改变；对同一 license + 同一物理机是稳定的。
     */
    @SuppressLint("HardwareIds")
    fun compute(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        val model = Build.MODEL ?: ""
        val raw = "$androidId|$model"
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(raw.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }.take(32)
    }

    /** 安全的 hostname slug（用于 agentId 生成，去掉非 ASCII 字符）。 */
    fun hostnameSlug(): String {
        val raw = Build.MODEL ?: ""
        return raw.replace(Regex("[^a-zA-Z0-9-]"), "-")
            .replace(Regex("-+"), "-")
            .trim('-')
            .lowercase()
            .ifEmpty { "android-device" }
    }
}
