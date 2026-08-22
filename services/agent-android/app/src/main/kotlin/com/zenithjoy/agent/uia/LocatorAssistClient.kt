package com.zenithjoy.agent.uia

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * AI on-call 刀2b：定位求助客户端（安卓侧）。
 *
 * RPA 某步找不到元素、马上要判死之前，把失败那一刻的树快照发给中台
 * `POST /api/agent/burner/locator-assist` 问"应该是哪个"，拿候选回来重试一次；
 * 用完候选把"本步预期状态是否真达成"回执给 `/locator-assist/verify`——
 * 这条 verified 是刀3 周报判"AI 在该机型×版本格子的答案稳不稳"的唯一依据。
 *
 * fail-open 铁律：本客户端任何失败（网络/超时/畸形响应）一律返回 null，
 * 调用方走原判死路径。保底通道绝不反过来变成新的崩溃点——所以解析层
 * 全部 try/catch 吞掉，纯逻辑（构造/解析/bounds 中心）JVM 单测钉死。
 */
object LocatorAssistClient {

    data class AssistCandidate(
        val line: Int,
        val viewId: String?,
        val text: String?,
        val contentDesc: String?,
        val bounds: String?,
    )

    data class AssistAnswer(
        val assistId: String?,
        val cacheHit: Boolean,
        val candidates: List<AssistCandidate>,
    )

    /** 求助超时：模型侧预算 20s，这里给到 25s 余量；RPA 步骤预算里这一步只发生在"本来就要判死"时。 */
    private const val TIMEOUT_SEC = 25L

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(TIMEOUT_SEC, TimeUnit.SECONDS)
            .build()
    }

    fun buildAssistBody(
        step: String,
        targetDesc: String,
        uiTree: String,
        errorCode: String?,
        deviceModel: String?,
        osVersion: String?,
        douyinVersion: String?,
        appVersion: String?,
        mode: String = "locate",
    ): String = JSONObject().apply {
        put("step", step)
        put("target_desc", targetDesc)
        put("ui_tree_snapshot", uiTree)
        if (mode != "locate") put("mode", mode)
        if (!errorCode.isNullOrBlank()) put("error_code", errorCode)
        if (!deviceModel.isNullOrBlank()) put("device_model", deviceModel)
        if (!osVersion.isNullOrBlank()) put("os_version", osVersion)
        if (!douyinVersion.isNullOrBlank()) put("douyin_version", douyinVersion)
        if (!appVersion.isNullOrBlank()) put("app_version", appVersion)
    }.toString()

    /** extract 响应 → (抽取值, assist_id)；unavailable/畸形 → null。 */
    fun parseExtractResponse(raw: String?): Pair<String, String?>? {
        if (raw.isNullOrBlank()) return null
        return try {
            val data = JSONObject(raw).optJSONObject("data") ?: return null
            if (data.optString("status") != "ok") return null
            val v = data.optString("extracted_value").takeIf { it.isNotBlank() && it != "null" } ?: return null
            Pair(v, data.optString("assist_id").takeIf { it.isNotBlank() && it != "null" })
        } catch (_: Exception) {
            null
        }
    }

    /** 同步 extract 求助。任何失败返回 null。 */
    fun requestExtractBlocking(httpBase: String, body: String): Pair<String, String?>? = try {
        val req = Request.Builder()
            .url("$httpBase/api/agent/burner/locator-assist")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp -> parseExtractResponse(resp.body?.string()) }
    } catch (_: Exception) {
        null
    }

    /** ok 且有候选 → AssistAnswer；unavailable/畸形/异常 → null（fail-open）。 */
    fun parseAssistResponse(raw: String?): AssistAnswer? {
        if (raw.isNullOrBlank()) return null
        return try {
            val data = JSONObject(raw).optJSONObject("data") ?: return null
            if (data.optString("status") != "ok") return null
            val arr = data.optJSONArray("candidates") ?: return null
            val candidates = (0 until arr.length()).mapNotNull { i ->
                val c = arr.optJSONObject(i) ?: return@mapNotNull null
                AssistCandidate(
                    line = c.optInt("line", -1),
                    viewId = c.optString("view_id").takeIf { it.isNotBlank() && it != "null" && it != "-" },
                    text = c.optString("text").takeIf { it.isNotBlank() && it != "null" && it != "-" },
                    contentDesc = c.optString("content_desc").takeIf { it.isNotBlank() && it != "null" && it != "-" },
                    bounds = c.optString("bounds").takeIf { it.isNotBlank() && it != "null" },
                )
            }
            if (candidates.isEmpty()) return null
            AssistAnswer(
                assistId = data.optString("assist_id").takeIf { it.isNotBlank() && it != "null" },
                cacheHit = data.optBoolean("cache_hit", false),
                candidates = candidates,
            )
        } catch (_: Exception) {
            null
        }
    }

    /** "[l,t][r,b]" → 中心点；解析不了 → null。手势兜底（无 viewId 的候选）落点用。 */
    fun boundsCenter(bounds: String?): Pair<Int, Int>? {
        if (bounds.isNullOrBlank()) return null
        val m = Regex("""\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]""").find(bounds) ?: return null
        val (l, t, r, b) = m.destructured
        return try {
            Pair((l.toInt() + r.toInt()) / 2, (t.toInt() + b.toInt()) / 2)
        } catch (_: Exception) {
            null
        }
    }

    fun buildVerifyBody(assistId: String, verified: Boolean): String =
        JSONObject().apply {
            put("assist_id", assistId)
            put("verified", verified)
        }.toString()

    /** 同步求助（调用方须在 IO 线程/协程）。任何失败返回 null。 */
    fun requestAssistBlocking(httpBase: String, body: String): AssistAnswer? = try {
        val req = Request.Builder()
            .url("$httpBase/api/agent/burner/locator-assist")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp -> parseAssistResponse(resp.body?.string()) }
    } catch (_: Exception) {
        null
    }

    /** 回执（fire-and-forget，调用方在 IO 线程）。失败只吞——回执丢了不影响主流程。 */
    fun reportVerifiedBlocking(httpBase: String, assistId: String, verified: Boolean) {
        try {
            val req = Request.Builder()
                .url("$httpBase/api/agent/burner/locator-assist/verify")
                .post(buildVerifyBody(assistId, verified).toRequestBody("application/json".toMediaType()))
                .build()
            http.newCall(req).execute().close()
        } catch (_: Exception) {
            // fail-open
        }
    }
}
