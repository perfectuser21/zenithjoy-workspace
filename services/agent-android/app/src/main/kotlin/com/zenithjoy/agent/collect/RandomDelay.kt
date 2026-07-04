package com.zenithjoy.agent.collect

import kotlin.random.Random

/**
 * 随机化操作间隔。禁止 callers 用固定常量 sleep。
 * 所有延迟入口通过此对象暴露，方便测试时注入。
 */
object RandomDelay {
    /** 轻操作间隔：点击后等待 UI 响应。 */
    val CLICK_MS: LongRange get() = 800L..1_800L
    /** 导航间隔：页面跳转后等待渲染。 */
    val NAV_MS: LongRange get() = 1_500L..3_000L
    /** 搜索等待：输入完成到结果出现。 */
    val SEARCH_MS: LongRange get() = 2_000L..4_000L
    /** 提取等待：进入主页后等待字段渲染。 */
    val PROFILE_MS: LongRange get() = 1_800L..3_500L

    fun sample(range: LongRange): Long = Random.nextLong(range.first, range.last + 1)
}
