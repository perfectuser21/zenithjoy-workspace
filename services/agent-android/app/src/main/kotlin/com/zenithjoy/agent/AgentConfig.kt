package com.zenithjoy.agent

import android.content.Context
import android.content.SharedPreferences

/**
 * Agent 配置存取（SharedPreferences，对齐桌面 agent 的 config.json 字段集）。
 * 首次启动通过 MainActivity 写入 licenseKey；之后 register 返回的字段持久化在此。
 */
class AgentConfig(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("zenithjoy_agent_config", Context.MODE_PRIVATE)

    var licenseKey: String
        get() = prefs.getString(KEY_LICENSE_KEY, "") ?: ""
        set(v) = prefs.edit().putString(KEY_LICENSE_KEY, v).apply()

    var agentId: String
        get() = prefs.getString(KEY_AGENT_ID, "") ?: ""
        set(v) = prefs.edit().putString(KEY_AGENT_ID, v).apply()

    /** ws_token 从 register 响应写入，WS 连接时作为 token query param（兼容 ws1 协议）。 */
    var wsToken: String
        get() = prefs.getString(KEY_WS_TOKEN, "") ?: ""
        set(v) = prefs.edit().putString(KEY_WS_TOKEN, v).apply()

    var machineId: String
        get() = prefs.getString(KEY_MACHINE_ID, "") ?: ""
        set(v) = prefs.edit().putString(KEY_MACHINE_ID, v).apply()

    /** register 返的 agents.id (UUID)，WS hello 带此复用行。 */
    var agentUuid: String
        get() = prefs.getString(KEY_AGENT_UUID, "") ?: ""
        set(v) = prefs.edit().putString(KEY_AGENT_UUID, v).apply()

    var tier: String
        get() = prefs.getString(KEY_TIER, "") ?: ""
        set(v) = prefs.edit().putString(KEY_TIER, v).apply()

    /** register() 最近一次失败原因（中文），成功后清空。状态页"未注册"旁展示，免得用户抓 adb。 */
    var lastRegisterError: String
        get() = prefs.getString(KEY_LAST_REGISTER_ERROR, "") ?: ""
        set(v) = prefs.edit().putString(KEY_LAST_REGISTER_ERROR, v).apply()

    /** apiUrl: wss://api.zenithjoy.com/agent-ws */
    var apiUrl: String
        get() = prefs.getString(KEY_API_URL, DEFAULT_WS_URL) ?: DEFAULT_WS_URL
        set(v) = prefs.edit().putString(KEY_API_URL, v).apply()

    /** HTTP base URL，从 apiUrl 推导或手动设置。 */
    var registerApiUrl: String
        get() = prefs.getString(KEY_REGISTER_API_URL, "") ?: ""
        set(v) = prefs.edit().putString(KEY_REGISTER_API_URL, v).apply()

    val isRegistered: Boolean
        get() = wsToken.isNotEmpty()

    val isConfigured: Boolean
        get() = licenseKey.isNotEmpty()

    fun deriveHttpBase(): String {
        if (registerApiUrl.isNotEmpty()) return registerApiUrl
        return apiUrl
            .replace(Regex("^wss://"), "https://")
            .replace(Regex("^ws://"), "http://")
            .replace(Regex("/agent-ws/?$"), "")
    }

    companion object {
        private const val KEY_LICENSE_KEY = "license_key"
        private const val KEY_AGENT_ID = "agent_id"
        private const val KEY_WS_TOKEN = "ws_token"
        private const val KEY_MACHINE_ID = "machine_id"
        private const val KEY_AGENT_UUID = "agent_uuid"
        private const val KEY_TIER = "tier"
        private const val KEY_API_URL = "api_url"
        private const val KEY_REGISTER_API_URL = "register_api_url"
        private const val KEY_LAST_REGISTER_ERROR = "last_register_error"

        const val DEFAULT_WS_URL = "wss://api.zenithjoy.com/agent-ws"

        // 与后端 apps/api/src/services/license.service.ts 的 LICENSE_KEY_PATTERN 保持一致，
        // 客户端先校验一次，避免格式错误的 key 绕一圈网络才在服务端 400。
        private val LICENSE_KEY_PATTERN = Regex("^ZJ-[FBMSE]-[A-Z0-9]{8}$")

        fun isValidLicenseKeyFormat(key: String): Boolean = LICENSE_KEY_PATTERN.matches(key)
    }
}
