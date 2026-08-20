package com.zenithjoy.agent

import java.util.logging.Filter
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger

/**
 * 掐断 okhttp 的内部 debug 日志。
 *
 * 真机实测(2026-08-19 小白 realme RMX3478 / 小黄 荣耀 MAA-AN00)：两台机器的 ROM 都设了
 * `persist.log.tag=V`，于是 okhttp 4.12 内部每条日志前的 `logger.isLoggable(Level.FINE)`
 * 恒为真，`okhttp.TaskRunner` / `okhttp.Http2` 每秒刷十几行。
 * 按 pid 抓小白 agent 的日志，**302 行里 286 行是 okhttp 噪音（95%）**，
 * agent 自己的日志活不过 1 分钟就被冲出 logcat 环形缓冲区。
 *
 * 这不是"日志难看"，是**排查瘫痪**：2026-08-19 据此误判出「initAgent 协程挂起不返回」，
 * 实际轮询一直正常（探针任务 31 秒内被拉走），一整天烧在幻觉上。
 *
 * ⚠️ 只设 `Level.OFF` **挡不住**（2.1.31 真机实测，噪音仍占 93%）：okhttp 的
 * `Platform$Companion` 在首次使用时调 `AndroidLog.enable()`，其 `enableLogging` 里
 *     `logger.setLevel(if (Log.isLoggable(tag, DEBUG)) FINE else INFO)`
 * 会把我们在 `Application.onCreate` 里设的 OFF **覆盖回 FINE**
 * （tag 映射见 `AndroidLog.knownLoggers`：`okhttp3.internal.concurrent.TaskRunner`
 * → `okhttp.TaskRunner`，正是 logcat 里刷屏的那个 tag）。
 *
 * 正解是 **Filter**：`enable()` 从不碰 filter，而 `Logger.log(record)` 在 level 检查之后
 * 还会过一道 filter，过不去就不 publish 到 handler → logcat 干净，与 level 被谁改无关。
 * level 也照设——silence() 万一在 enable() 之后跑，它能省掉 okhttp 那边的字符串拼装。
 */
object OkHttpDebugLogSilencer {

    /** 真机 logcat 实录到的刷屏来源，以及它们的父 logger。 */
    val SILENCED_LOGGER_NAMES = listOf(
        "okhttp3",
        "okhttp3.OkHttpClient",
        "okhttp3.internal.concurrent.TaskRunner",
        "okhttp3.internal.http2.Http2",
        "okhttp3.internal.http2.Http2Reader",
        "okhttp3.internal.http2.Http2Writer",
    )

    // java.util.logging 只对 Logger 持弱引用：不留强引用的话，Logger 被 GC 后
    // 下次 getLogger 会拿到一个 level 复位成 null(继承父级) 的新实例，静音悄悄失效。
    private val strongRefs = mutableListOf<Logger>()

    /** 一律拒绝：okhttp 的内部日志我们一条都不要，SEVERE 也不要。 */
    private val rejectAll = Filter { _: LogRecord -> false }

    @Synchronized
    fun silence() {
        SILENCED_LOGGER_NAMES.forEach { name ->
            val logger = Logger.getLogger(name)
            logger.filter = rejectAll
            // filter 是真正管用的那道——AndroidLog.enable() 只改 level/handler，从不碰 filter
            logger.level = Level.OFF
            logger.useParentHandlers = false
            if (strongRefs.none { it === logger }) strongRefs.add(logger)
        }
    }
}
