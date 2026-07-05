package com.zenithjoy.agent.collect

/**
 * Sprint 07052218 — 抖音私信触达本地频控计数器。
 * PRD NFR：10 分钟窗口内已发 >=3 条则本次不发，等下一个时间窗；窗口外历史不计入。
 * 纯函数，不依赖 Android 框架，方便脱离设备单测。
 */
object DmOutreachRateLimiter {
    /**
     * @param sentTimestampsMs 历史发送时间戳（毫秒，任意顺序）
     * @param nowMs 当前时刻（毫秒）
     * @param windowMs 频控窗口长度，默认 10 分钟
     * @param maxCount 窗口内允许的最大发送数，默认 3
     * @return true = 允许本次发送；false = 拒绝（窗口内已达上限）
     */
    fun isWithinLimit(
        sentTimestampsMs: List<Long>,
        nowMs: Long,
        windowMs: Long = 600_000L,
        maxCount: Int = 3,
    ): Boolean {
        val windowStart = nowMs - windowMs
        val countInWindow = sentTimestampsMs.count { it >= windowStart }
        return countInWindow < maxCount
    }
}
