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

    data class RegisterRequest(
        val licenseKey: String,
        val machineId: String,
        val hostname: String,
        val agentId: String,
        val version: String,
        val httpBase: String,
    )

    data class RegisterResult(
        val wsToken: String,
        val machineId: String,
        val tier: String?,
        val maxMachines: Int?,
        val agentUuid: String?,
    )

    /**
     * register() 失败原因必须带回调用方——真机排障发现普通用户没有 adb 权限，
     * "未注册"三个字看不出到底是格式错/License不存在/配额用满还是网络问题。
     */
    sealed class RegisterOutcome {
        data class Success(val result: RegisterResult) : RegisterOutcome()
        data class Failure(val reason: String) : RegisterOutcome()
    }

    /**
     * 调用 POST /api/agent/register，返回 RegisterOutcome（成功/失败均带具体信息）。
     */
    suspend fun register(request: RegisterRequest): RegisterOutcome {
        val url = "${request.httpBase}/api/agent/register"

        val body = gson.toJson(mapOf(
            "license_key" to request.licenseKey,
            "machine_id" to request.machineId,
            "hostname" to request.hostname,
            "agent_id" to request.agentId,
            "version" to request.version,
            "os_type" to "android",
        ))

        val httpRequest = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            val response = httpClient.newCall(httpRequest).execute()
            val raw = response.body?.string() ?: ""
            val parsed = runCatching { gson.fromJson(raw, RegisterResponse::class.java) }.getOrNull()

            if (!response.isSuccessful) {
                val reason = describeRegisterFailure(response.code, parsed?.code, parsed?.message)
                logE("register failed [${response.code}]: $raw")
                return RegisterOutcome.Failure(reason)
            }
            if (parsed == null || !parsed.ok || parsed.ws_token.isNullOrEmpty()) {
                logE("register response invalid: $raw")
                return RegisterOutcome.Failure("服务器返回数据异常，请稍后重试")
            }
            logI("registered — tier=${parsed.tier} machineId=${parsed.registered_machine_id}")
            RegisterOutcome.Success(
                RegisterResult(
                    wsToken = parsed.ws_token,
                    machineId = parsed.registered_machine_id ?: request.machineId,
                    tier = parsed.tier,
                    maxMachines = parsed.max_machines,
                    agentUuid = parsed.agent_id,
                )
            )
        } catch (e: IOException) {
            logE("register network error: ${e.message}")
            RegisterOutcome.Failure("网络错误：无法连接服务器（${e.message ?: "unknown"}）")
        }
    }

    // JVM 单元测试环境下 android.util.Log 未 mock，吞掉（同 AudioCaptureService/ContentJudgmentService 约定）。
    private fun logI(message: String) {
        try { android.util.Log.i(TAG, message) } catch (_: RuntimeException) { }
    }

    private fun logE(message: String) {
        try { android.util.Log.e(TAG, message) } catch (_: RuntimeException) { }
    }

    private data class RegisterResponse(
        val ok: Boolean = false,
        val ws_token: String? = null,
        val registered_machine_id: String? = null,
        val tier: String? = null,
        val max_machines: Int? = null,
        val agent_id: String? = null,
        val code: String? = null,
        val message: String? = null,
    )

    companion object {
        private const val TAG = "AgentRegistrar"

        // 统一到 AgentService.buildReportHttpClient 同款连接池配置（见 #1345），
        // 避免与其它低频调用客户端不一致造成的排查混乱。
        internal fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
            .build()
    }
}

/**
 * 把 /api/agent/register 的失败响应翻译成人能看懂的中文原因，供状态页直接展示。
 * 服务端各失败分支（BAD_REQUEST/INVALID_LICENSE/EXPIRED/SUSPENDED/QUOTA_EXCEEDED）
 * 早已带中文 message，优先原样透传；message 缺失时按 code 给兜底文案。
 */
internal fun describeRegisterFailure(httpCode: Int, code: String?, message: String?): String {
    if (!message.isNullOrBlank()) return message
    return when (code) {
        "BAD_REQUEST" -> "License Key 格式不合法，应为 ZJ-X-XXXXXXXX"
        "INVALID_LICENSE" -> "License Key 不存在"
        "EXPIRED" -> "License 已过期或已吊销"
        "SUSPENDED" -> "License 已被暂停"
        "QUOTA_EXCEEDED" -> "装机数已达上限"
        else -> "注册失败（HTTP $httpCode）"
    }
}
