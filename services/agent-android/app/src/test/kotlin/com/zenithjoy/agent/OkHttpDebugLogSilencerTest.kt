package com.zenithjoy.agent

import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * 真机确诊(2026-08-19 小白 realme RMX3478 / 小黄 荣耀 MAA-AN00)：
 * 两台机器的 `getprop` 里都有 **`[persist.log.tag]: [V]`**（ROM 把全局日志级别设成 VERBOSE），
 * okhttp 4.12 内部每条 debug 日志前的 `logger.isLoggable(Level.FINE)` 因此恒真，
 * `okhttp.TaskRunner` / `okhttp.Http2` 疯狂刷 logcat。
 *
 * 实测：按 pid 抓小白 agent 的日志，**302 行里 286 行是 okhttp 噪音（95%）**，
 * agent 自己的日志活不过 1 分钟就被冲出环形缓冲区。
 *
 * 后果不是"日志难看"，是**排查瘫痪**：2026-08-19 交接单据此得出
 * 「按 pid 抓全量 logcat 只有 WebSocket 活动」「没有 agent started 这行」→
 * 推论"initAgent 协程挂起不返回"——整条结论都是缓冲区淘汰造成的幻觉，
 * 真相是轮询一直在正常跑（探针任务 31 秒内被拉走）。烧掉了一整天。
 *
 * ⚠️ 第一版修法（只设 `Level.OFF`）**真机无效**，2.1.31 实测噪音仍占 93%（57 行里 53 行）：
 * okhttp 的 `Platform$Companion` 在首次使用时调 `AndroidLog.enable()`，其 `enableLogging` 里
 *     `logger.setLevel(if (Log.isLoggable(tag, DEBUG)) FINE else INFO)`
 * 会把 `Application.onCreate` 里设的 `Level.OFF` **覆盖掉**（tag 映射见 AndroidLog.knownLoggers：
 * `okhttp3.internal.concurrent.TaskRunner` → `okhttp.TaskRunner`，正是 logcat 里看到的那个）。
 *
 * 而当时的单测只断言「设完 OFF 后 isLoggable(FINE)=false」——这句在纯 JVM 里是真的，
 * 却**根本没覆盖被覆盖回去那条路径**。测试绿、真机没变，是假信心。
 *
 * 正解：**Filter**。`enable()` 从不碰 filter，而 `Logger.log()` 在 level 检查之后还会过 filter，
 * 过不去就不 publish 到 handler → logcat 干净。level 也照设（silence() 在 enable() 之后跑时它有用）。
 */
class OkHttpDebugLogSilencerTest {

    @Test
    fun `静音后 okhttp 内部 logger 不再认为 FINE 可输出`() {
        OkHttpDebugLogSilencer.silence()

        OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES.forEach { name ->
            assertFalse(
                "$name 仍然允许 FINE 输出 —— okhttp 会继续刷屏，agent 日志照样被冲掉",
                Logger.getLogger(name).isLoggable(Level.FINE),
            )
        }
    }

    // ── 真机路径：okhttp 初始化会把 level 覆盖回 FINE，只设 level 的做法在这里必然失效 ──
    @Test
    fun `okhttp 把 level 覆盖回 FINE 之后，仍然一条都不许输出`() {
        OkHttpDebugLogSilencer.silence()

        OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES.forEach { name ->
            val logger = Logger.getLogger(name)
            // 复刻 AndroidLog.enableLogging 的行为：setUseParentHandlers(false) + setLevel(FINE) + addHandler
            logger.useParentHandlers = false
            logger.level = Level.FINE

            val filter = logger.filter
            assertNotNull(
                "$name 没有 filter —— level 一旦被 okhttp 覆盖回 FINE，静音就彻底失效（2.1.31 真机实证）",
                filter,
            )
            assertFalse(
                "$name 的 filter 放行了 FINE 记录，等于没静音",
                filter!!.isLoggable(LogRecord(Level.FINE, "okhttp noise")),
            )
        }
    }

    @Test
    fun `filter 连 SEVERE 也拦——okhttp 内部日志我们一条都不要`() {
        OkHttpDebugLogSilencer.silence()
        val filter = Logger.getLogger(OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES.first()).filter

        assertNotNull(filter)
        assertFalse(filter!!.isLoggable(LogRecord(Level.SEVERE, "okhttp noise")))
    }

    @Test
    fun `必须覆盖真机实录到的两个刷屏来源 TaskRunner 与 Http2`() {
        val names = OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES

        assertFalse(
            "真机 logcat 里刷屏最凶的是 okhttp.TaskRunner，必须被覆盖",
            names.none { it.contains("TaskRunner") },
        )
        assertFalse(
            "第二个刷屏来源是 okhttp.Http2（>> / << 每帧一行），必须被覆盖",
            names.none { it.contains("Http2") },
        )
    }

    @Test
    fun `重复调用幂等——onCreate 可能被多次触发`() {
        OkHttpDebugLogSilencer.silence()
        OkHttpDebugLogSilencer.silence()

        assertFalse(Logger.getLogger(OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES.first()).isLoggable(Level.FINE))
    }

    @Test
    fun `持有强引用防止 Logger 被 GC 后 level 复位`() {
        OkHttpDebugLogSilencer.silence()
        System.gc()

        OkHttpDebugLogSilencer.SILENCED_LOGGER_NAMES.forEach { name ->
            assertFalse(
                "$name 的 level 在 GC 后复位了 —— java.util.logging 只持弱引用，必须自己留强引用",
                Logger.getLogger(name).isLoggable(Level.FINE),
            )
            assertNotNull("$name 的 filter 在 GC 后没了", Logger.getLogger(name).filter)
        }
    }
}
