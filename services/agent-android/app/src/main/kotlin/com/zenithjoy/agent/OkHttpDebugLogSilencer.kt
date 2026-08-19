package com.zenithjoy.agent

import java.util.logging.Level
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
 * okhttp 每条内部日志都先过 `logger.isLoggable(Level.FINE)`，把对应 logger 显式设成
 * `Level.OFF` 即可从源头掐断，与 ROM 的 log.tag 属性无关。
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

    @Synchronized
    fun silence() {
        SILENCED_LOGGER_NAMES.forEach { name ->
            val logger = Logger.getLogger(name)
            logger.level = Level.OFF
            logger.useParentHandlers = false
            if (strongRefs.none { it === logger }) strongRefs.add(logger)
        }
    }
}
