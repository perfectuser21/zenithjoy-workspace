package com.zenithjoy.agent.publish

import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 发布任务基座段轮询（刀A，line01 智能发布）。agent 的第 4 条轮询线，照
 * [com.zenithjoy.agent.AcquisitionCollectPollLoop] 模式（30s、no-pool client、
 * 每个丢弃分支留日志）。
 *
 * 每 30s：GET /api/publish-tasks?status=queued（鉴权 X-Upload-Token: licenseKey，
 * 与 AI 执行器同一凭据同一 header，不新造第四套）→ 逐单 POST /:id/claim（中台 CAS
 * queued→dispatched，多机同租户谁先落库谁抢到）→ claimed=true 才 GET /:id/package →
 * 逐 media 流式下载到 cacheDir（okhttp byteStream 直写文件，绝不整段 readBytes 进
 * 内存——视频可能几百 MB）→ [saveToGallery] 落相册 → 清 cache 临时文件。
 *
 * 失败语义 fail-visible（设计 spec 决策5）：
 *   - claim 前失败（列表/claim 请求失败、没抢到）→ 零副作用，留日志等下轮；
 *   - claim 后任何失败（领包/下载/落相册）→ PATCH /:id/receipt {result:'failed',
 *     detail:'<哪步+现象>'}，编排台立刻看到"派发失败"，latest-wins 重发兜底，
 *     绝不静默留 dispatched 黑洞。
 *
 * 基座段成功不回执——素材落相册只是把 ADB push 环节前置，终态回执由真正执行
 * App 内发布的一方（AI 执行器 / android-publish skill）回。
 */
class PublishPollLoop(
    // 实时读取，不是构造时快照——licenseKey 可能在服务运行中经 MainActivity 重新绑定。
    private val licenseKey: () -> String,
    private val httpBase: String,
    private val scope: CoroutineScope,
    /** 下载暂存目录（生产传 context.cacheDir）。落相册成功/失败都清理。 */
    private val cacheDir: File,
    /** 落相册回调（生产接 [MediaSaver.saveToGallery]），返回 false = 落相册失败。 */
    private val saveToGallery: (file: File, fileName: String, mimeType: String?) -> Boolean,
    private val intervalMs: Long = 30_000L,
    private val httpClient: OkHttpClient = defaultClient(),
    // 回执重试间隔可注入，测试不真睡（照 CollectReporter.postWithRetry 模式）。
    private val sleepFn: (Long) -> Unit = { Thread.sleep(it) },
) {
    private val gson = Gson()
    private var job: Job? = null

    private data class TaskItem(val id: String = "", val platform: String = "", val status: String = "")
    private data class ListData(val items: List<TaskItem>? = null)
    private data class ListResponse(val data: ListData? = null)
    private data class ClaimData(val claimed: Boolean = false, val status: String? = null)
    private data class ClaimResponse(val data: ClaimData? = null)
    private data class MediaItem(val url: String = "", val file_name: String = "", val mime_type: String? = null)
    private data class PackageData(val media: List<MediaItem>? = null)
    private data class PackageResponse(val data: PackageData? = null)

    fun start() {
        // 首次 poll 同步执行（同 AcquisitionCollectPollLoop.start 的约定），
        // start() 返回时第一轮已跑完，行为确定、不依赖协程调度。
        pollOnce()
        job = scope.launch { loop() }
        activeInstance = this
    }

    fun stop() {
        job?.cancel()
        if (activeInstance === this) activeInstance = null
    }

    private suspend fun loop() {
        while (scope.isActive) {
            delay(intervalMs)
            pollOnce()
        }
    }

    /** 单次轮询，供测试与 debug 触发器直接调用。同步函数（非 suspend）。 */
    fun pollOnce() {
        val key = licenseKey()
        if (key.isEmpty()) return

        val base = httpBase.trimEnd('/')
        val listRequest = Request.Builder()
            .url("$base/api/publish-tasks?status=queued")
            .header(HEADER_TOKEN, key)
            .get()
            .build()
        val listBody = executeForBody(listRequest, "publish-tasks 列表") ?: return
        val parsed = try {
            gson.fromJson(listBody, ListResponse::class.java)
        } catch (e: RuntimeException) {
            logW("poll: 列表响应解析失败——${e.message}")
            return
        }
        val items = parsed?.data?.items ?: return
        if (items.isNotEmpty()) {
            logI("poll: 发现 ${items.size} 个排队中的发布单")
        }

        items.forEach { item ->
            if (item.id.isEmpty()) {
                logW("poll: 丢弃一个发布单——id 为空 platform=${item.platform}")
                return@forEach
            }
            processTask(base, key, item.id)
        }
    }

    private fun processTask(base: String, key: String, taskId: String) {
        // 认领：中台 CAS queued→dispatched。claim 前任何失败零副作用，留日志等下轮。
        val claimRequest = Request.Builder()
            .url("$base/api/publish-tasks/$taskId/claim")
            .header(HEADER_TOKEN, key)
            .post("{}".toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val claimBody = executeForBody(claimRequest, "claim task=$taskId") ?: run {
            logW("claim 请求失败 task=$taskId——本轮跳过，下轮 30s 后重试")
            return
        }
        val claim = try {
            gson.fromJson(claimBody, ClaimResponse::class.java)
        } catch (e: RuntimeException) {
            logW("claim 响应解析失败 task=$taskId——${e.message}")
            return
        }
        if (claim?.data?.claimed != true) {
            logI("claim 未抢到 task=$taskId status=${claim?.data?.status ?: "unknown"}——已被其他执行器认领，跳过")
            return
        }

        // —— claim 之后任何失败必须 fail-visible：PATCH failed 回执，绝不静默留 dispatched 黑洞 ——
        val downloaded = mutableListOf<File>()
        try {
            val pkgRequest = Request.Builder()
                .url("$base/api/publish-tasks/$taskId/package")
                .header(HEADER_TOKEN, key)
                .get()
                .build()
            val pkgBody = executeForBody(pkgRequest, "package task=$taskId")
            if (pkgBody == null) {
                reportFailed(base, key, taskId, "领发布包失败：GET /package 网络错误或非 2xx")
                return
            }
            val pkg = try {
                gson.fromJson(pkgBody, PackageResponse::class.java)
            } catch (e: RuntimeException) {
                reportFailed(base, key, taskId, "领发布包失败：响应解析异常 ${e.message}")
                return
            }
            val media = pkg?.data?.media ?: emptyList()
            if (media.isEmpty()) {
                reportFailed(base, key, taskId, "发布包为空：media 列表缺失或为空")
                return
            }

            // 逐 media 下载到 cacheDir（流式写文件）。
            for (m in media) {
                val safeName = m.file_name.substringAfterLast('/')
                    .ifEmpty { "media_${System.currentTimeMillis()}" }
                val dest = File(cacheDir, safeName)
                if (!downloadToFile(m.url, dest)) {
                    downloaded.add(dest) // 半截残片也要进清理名单
                    reportFailed(base, key, taskId, "下载素材失败：$safeName（网络错误或非 2xx，详见设备日志）")
                    return
                }
                downloaded.add(dest)
            }

            // 全部下载成功后逐个落相册。
            for ((idx, m) in media.withIndex()) {
                val file = downloaded[idx]
                val saved = try {
                    saveToGallery(file, file.name, m.mime_type)
                } catch (e: Exception) {
                    logW("落相册异常 task=$taskId file=${file.name}: ${e.message}")
                    false
                }
                if (!saved) {
                    reportFailed(base, key, taskId, "落相册失败：${file.name}（MediaSaver 返回 false 或异常，详见设备日志）")
                    return
                }
            }
            logI("task=$taskId 素材已全部落相册（${media.size} 个），等待 AI 执行器接手 App 内发布")
        } catch (e: Exception) {
            reportFailed(base, key, taskId, "处理发布单异常：${e.javaClass.simpleName} ${e.message}")
        } finally {
            // 成功=素材已在相册、失败=编排台重发后重下，cache 临时文件一律清掉
            // （视频可能几百 MB，残留会撑爆客户手机存储）。
            downloaded.forEach { f ->
                if (f.exists() && !f.delete()) logW("cache 清理失败：${f.absolutePath}")
            }
        }
    }

    /** 流式下载：okhttp byteStream 直写文件，绝不整段 readBytes 进内存。 */
    private fun downloadToFile(url: String, dest: File): Boolean {
        return try {
            val request = Request.Builder().url(url).get().build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    logW("下载 http ${response.code} → ${dest.name}")
                    return false
                }
                val body = response.body ?: run {
                    logW("下载响应无 body → ${dest.name}")
                    return false
                }
                body.byteStream().use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                }
                true
            }
        } catch (e: IOException) {
            logW("下载失败 ${dest.name}: ${e.message}")
            false
        }
    }

    /**
     * failed 回执：PATCH /:id/receipt {result:'failed', detail}。
     * 照 CollectReporter.postWithRetry 模式：网络错误/非 2xx 重试 1 次（间隔 5s，可注入）。
     */
    private fun reportFailed(base: String, key: String, taskId: String, detail: String, retryLeft: Int = 1) {
        logW("task=$taskId 失败回执：$detail")
        val body = gson.toJson(mapOf("result" to "failed", "detail" to detail))
        try {
            val request = Request.Builder()
                .url("$base/api/publish-tasks/$taskId/receipt")
                .header(HEADER_TOKEN, key)
                .patch(body.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.code !in 200..299) {
                    if (retryLeft > 0) {
                        sleepFn(RETRY_DELAY_MS)
                        reportFailed(base, key, taskId, detail, retryLeft - 1)
                    } else {
                        logW("failed 回执未送达 task=$taskId http=${response.code}——编排台只能靠超时兜底")
                    }
                }
            }
        } catch (e: Exception) {
            if (retryLeft > 0) {
                sleepFn(RETRY_DELAY_MS)
                reportFailed(base, key, taskId, detail, retryLeft - 1)
            } else {
                logW("failed 回执未送达 task=$taskId: ${e.message}——编排台只能靠超时兜底")
            }
        }
    }

    /**
     * 单次 HTTP 执行，不重试（失败/非 2xx 只记日志返回 null，下一轮 30s 轮询自然重试）。
     * 同 AcquisitionCollectPollLoop.executeOnce 的纪律。
     */
    private fun executeForBody(request: Request, what: String): String? {
        return try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    logW("$what http ${response.code}")
                    return null
                }
                response.body?.string()
            }
        } catch (e: IOException) {
            logW("$what error: ${e.message}")
            null
        }
    }

    /** android.util.Log 在纯 JVM 单测下未 mock 会抛 RuntimeException，吞掉保证不因日志而崩。 */
    private fun logI(message: String) {
        try {
            android.util.Log.i(TAG, message)
        } catch (_: RuntimeException) {
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
        }
    }

    companion object {
        private const val TAG = "PublishPollLoop"
        private const val HEADER_TOKEN = "X-Upload-Token"
        private const val RETRY_DELAY_MS = 5_000L
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        /** 当前活跃实例：仅供 debug 变体的 DEBUG_E2E publish flow 触发单轮 poll。 */
        @Volatile
        private var activeInstance: PublishPollLoop? = null

        /** debug 触发单轮 poll。@return false = 没有活跃 loop（AgentService 未启动）。 */
        fun triggerSinglePollForDebug(): Boolean {
            val instance = activeInstance ?: return false
            instance.pollOnce()
            return true
        }

        // 真机复现(2026-07-17)：低频调用客户端长时间空闲后连接会被静默弄坏，同
        // AgentService.buildReportHttpClient 已验证过的根因（见 #1345）。
        // InfrequentHttpClientsNoPoolTest 锁定本配置不许回退。
        // 下载视频可能较慢，readTimeout 放宽到 60s（连接仍 15s 快失败）。
        internal fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
            .build()
    }
}
