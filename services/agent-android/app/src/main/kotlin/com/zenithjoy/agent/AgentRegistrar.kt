package com.zenithjoy.agent

import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 复用桌面 agent 的 POST /api/agent/register 流程。
 * 请求/响应字段与 zenithjoy/services/agent/src/index.ts registerWithLicense() 完全对齐。
 */
class AgentRegistrar(private val httpClient: OkHttpClient = defaultClient()) {

    private val gson = Gson()

    data class RegisterResult(
        val wsToken: String,
        val machineId: String,
        val tier: String?,
        val maxMachines: Int?,
        val agentUuid: String?,
    )

    /**
     * 调用 POST /api/agent/register，返回 RegisterResult，失败返回 null。
     */
    suspend fun register(config: AgentConfig): RegisterResult? {
        val httpBase = config.deriveHttpBase()
        val url = "$httpBase/api/agent/register"

        val body = gson.toJson(mapOf(
            "license_key" to config.licenseKey,
            "machine_id" to config.machineId,
            "hostname" to android.os.Build.MODEL,
            "agent_id" to config.agentId,
            "version" to AgentConfig.AGENT_VERSION,
            "os_type" to "android",
        ))

        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                val text = response.body?.string() ?: ""
                android.util.Log.e(TAG, "register failed [${response.code}]: $text")
                return null
            }
            val raw = response.body?.string() ?: return null
            val data = gson.fromJson(raw, RegisterResponse::class.java)
            if (!data.ok || data.ws_token.isNullOrEmpty()) {
                android.util.Log.e(TAG, "register response invalid: $raw")
                return null
            }
            android.util.Log.i(TAG, "registered — tier=${data.tier} machineId=${data.registered_machine_id}")
            RegisterResult(
                wsToken = data.ws_token,
                machineId = data.registered_machine_id ?: config.machineId,
                tier = data.tier,
                maxMachines = data.max_machines,
                agentUuid = data.agent_id,
            )
        } catch (e: IOException) {
            android.util.Log.e(TAG, "register network error: ${e.message}")
            null
        }
    }

    private data class RegisterResponse(
        val ok: Boolean = false,
        val ws_token: String? = null,
        val registered_machine_id: String? = null,
        val tier: String? = null,
        val max_machines: Int? = null,
        val agent_id: String? = null,
    )

    companion object {
        private const val TAG = "AgentRegistrar"

        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
