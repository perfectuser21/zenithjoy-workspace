package com.zenithjoy.agent.collect

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Seg3 抓评论回填真实抖音号（方案 B′）—— 纯逻辑合同（TDD Red 先行）。
 *
 * 背景（真机 2026-07-15 xian-rog 实证）：
 *   评论 avatar 节点 content-desc = "<昵称>的头像"、clickable=true；点它进全屏
 *   UserProfileActivity（与 DouyinDmOutreachService 搜索进的是同一个页面），该页一次 dump
 *   即含 `resource-id=.../5mt`、`text="抖音号：1689210742"`；BACK ×1 回评论面板且滚动位置保留。
 *   2/2 不同评论人复现（小叶子 1689210742 / LENTER心疼姑舅 1570369250）。
 *
 * 为什么必须做：派单侧现在把 profile_url 塞进 dm payload，而设备端
 * DouyinDmOutreachService.startOutreach() 把该字段【当抖音号搜索】→ 必然 NO_MATCH。
 * 只有抓评论阶段读出真实抖音号回填 lead，私信段才可能命中。
 *
 * 本文件锁死四块纯逻辑（Android 框架无关，JVM 可跑）：
 *   1. `DouyinDmOutreachService.extractDouyinId` —— 主页文本 → 抖音号（`verifyProfileMatchesDouyinId` 的孪生函数）
 *   2. `DouyinCollectService.avatarContentDesc` / `isBackAtCommentPanel` —— avatar 定位锚点 + 返回落点判据
 *   3. `DouyinCollectService.enrichEntries` —— enrich 编排核心（失败即 null，绝不造假）
 *   4. `DouyinCollectService.computeExtractionTimeoutMs` —— 看门狗预算（不调必整轮假失败）
 */
class DouyinIdEnrichTest {

    // ── 1. extractDouyinId ───────────────────────────────────────────────────
    //
    // 与 verifyProfileMatchesDouyinId 共用同一条判别：必须带 "抖音号：" 前缀。
    // 前缀是关键——搜索框回显的是【裸 id】（无前缀），真实主页 id 行永远带前缀，
    // 据此天然排除搜索框陷阱（见 DouyinDmOutreachService.kt:801 真机注释）。

    @Test
    fun `extractDouyinId 从真机主页文本读出抖音号（全角冒号）`() {
        val texts = listOf("小叶子", "抖音号：1689210742", "IP属地：陕西", "关注")
        assertEquals("1689210742", DouyinDmOutreachService.extractDouyinId(texts))
    }

    @Test
    fun `extractDouyinId 认半角冒号`() {
        val texts = listOf("LENTER心疼姑舅", "抖音号:1570369250")
        assertEquals("1570369250", DouyinDmOutreachService.extractDouyinId(texts))
    }

    @Test
    fun `extractDouyinId 认冒号后空格并 trim 整行`() {
        val texts = listOf("  抖音号： zenithjoy_666  ")
        assertEquals("zenithjoy_666", DouyinDmOutreachService.extractDouyinId(texts))
    }

    @Test
    fun `extractDouyinId 拒绝裸 id 回显（搜索框陷阱）——没有前缀就不是主页 id 行`() {
        // 搜索框回显 "1689210742"（无 "抖音号：" 前缀）。认了它就会把搜索框内容当成抖音号。
        val texts = listOf("1689210742", "搜索", "综合", "视频")
        assertNull(DouyinDmOutreachService.extractDouyinId(texts))
    }

    @Test
    fun `extractDouyinId 读不到主页 id 行时返回 null（宁可空不可猜）`() {
        val texts = listOf("小叶子", "IP属地：陕西", "获赞 128", "关注")
        assertNull(DouyinDmOutreachService.extractDouyinId(texts))
    }

    @Test
    fun `extractDouyinId 空列表返回 null`() {
        assertNull(DouyinDmOutreachService.extractDouyinId(emptyList()))
    }

    @Test
    fun `extractDouyinId 不吞行内噪声——前缀必须在行首且 id 不含空白`() {
        // "他的抖音号：123 是假的" 这类叙述句不是主页 id 行，不能命中。
        val texts = listOf("他的抖音号：123 是假的")
        assertNull(DouyinDmOutreachService.extractDouyinId(texts))
    }

    // ── 2. avatar 锚点 + 返回落点判据 ─────────────────────────────────────────

    @Test
    fun `avatarContentDesc 按真机 content-desc 规则拼昵称`() {
        assertEquals("小叶子的头像", DouyinCollectService.avatarContentDesc("小叶子"))
        assertEquals("LENTER心疼姑舅的头像", DouyinCollectService.avatarContentDesc("LENTER心疼姑舅"))
    }

    @Test
    fun `isBackAtCommentPanel 有 avatar 且无抖音号行 - 已回评论面板`() {
        assertTrue(DouyinCollectService.isBackAtCommentPanel(avatarCount = 5, hasDouyinIdLine = false))
    }

    @Test
    fun `isBackAtCommentPanel 还在主页（抖音号行仍在树上）- 未回到面板`() {
        // 照抄 navigateBackToResults 的教训：落点判据必须用【只有目标页才有】的内容锚点。
        // 主页也可能有 avatar 节点，单看 avatar 会误判"已回面板"→ 停止 BACK → 后续全错位。
        // "抖音号：" 行是主页独有的强判别（评论面板永远没有）。
        assertEquals(false, DouyinCollectService.isBackAtCommentPanel(avatarCount = 1, hasDouyinIdLine = true))
    }

    @Test
    fun `isBackAtCommentPanel 树上一个 avatar 都没有 - 未回到面板`() {
        assertEquals(false, DouyinCollectService.isBackAtCommentPanel(avatarCount = 0, hasDouyinIdLine = false))
    }

    // ── 3. enrichEntries 编排核心 ────────────────────────────────────────────
    //
    // 真机 UIA 动作由 resolve 回调注入（生产侧传入"点 avatar→等主页→读 id→BACK"的实现），
    // 这里锁死与 UIA 无关的编排铁律。

    @Test
    fun `enrichEntries 逐条按昵称回填抖音号`() = runBlocking {
        val entries = listOf(
            CommentEntry(commenterId = "小叶子", text = "怎么联系你们"),
            CommentEntry(commenterId = "LENTER心疼姑舅", text = "多少钱"),
        )
        val enriched = DouyinCollectService.enrichEntries(entries) { nickname ->
            when (nickname) {
                "小叶子" -> "1689210742"
                "LENTER心疼姑舅" -> "1570369250"
                else -> null
            }
        }
        assertEquals(listOf("1689210742", "1570369250"), enriched.map { it.douyinId })
        // 原有字段一个都不许丢
        assertEquals(listOf("小叶子", "LENTER心疼姑舅"), enriched.map { it.commenterId })
        assertEquals(listOf("怎么联系你们", "多少钱"), enriched.map { it.text })
    }

    @Test
    fun `enrichEntries 单条取不到就留 null，绝不造假 id，也不牵连其它条`() = runBlocking {
        val entries = listOf(
            CommentEntry(commenterId = "甲", text = "a"),
            CommentEntry(commenterId = "乙", text = "b"),
            CommentEntry(commenterId = "丙", text = "c"),
        )
        val enriched = DouyinCollectService.enrichEntries(entries) { nickname ->
            if (nickname == "乙") null else "id-$nickname"
        }
        assertEquals(listOf("id-甲", null, "id-丙"), enriched.map { it.douyinId })
        // 取不到 ≠ 丢条：评论本身仍要进库（Seg3 lead 不能因为没读到号就消失）
        assertEquals(3, enriched.size)
    }

    @Test
    fun `enrichEntries 单条抛异常不炸整轮，该条 null 其余照常`() = runBlocking {
        val entries = listOf(
            CommentEntry(commenterId = "甲", text = "a"),
            CommentEntry(commenterId = "炸", text = "b"),
            CommentEntry(commenterId = "丙", text = "c"),
        )
        val enriched = DouyinCollectService.enrichEntries(entries) { nickname ->
            if (nickname == "炸") throw IllegalStateException("UIA stale node")
            "id-$nickname"
        }
        assertEquals(listOf("id-甲", null, "id-丙"), enriched.map { it.douyinId })
    }

    @Test
    fun `enrichEntries 空白 id 归一成 null（不把空串当抖音号写进库）`() = runBlocking {
        val entries = listOf(CommentEntry(commenterId = "甲", text = "a"))
        val enriched = DouyinCollectService.enrichEntries(entries) { "   " }
        assertNull(enriched[0].douyinId)
    }

    @Test
    fun `enrichEntries 空评论列表直接返回空，不调 resolve`() = runBlocking {
        var called = 0
        val enriched = DouyinCollectService.enrichEntries(emptyList()) { called++; "x" }
        assertTrue(enriched.isEmpty())
        assertEquals(0, called)
    }

    @Test
    fun `enrichEntries 每条都按昵称重新定位——resolve 只收昵称，不接受跨 BACK 复用的节点句柄`() = runBlocking {
        // 铁律：avatar handle 绝不跨 BACK 复用（跨窗口后旧节点 stale → 遍历为空 → 假失败，
        // captureShareUrlForCard 血泪注释 DouyinCollectService.kt:625-632）。
        // 契约层面的体现：resolve 的入参只有昵称，每条都必须重抓 root 按 content-desc 重新定位。
        val seen = mutableListOf<String>()
        val entries = listOf(
            CommentEntry(commenterId = "甲", text = "a"),
            CommentEntry(commenterId = "乙", text = "b"),
        )
        DouyinCollectService.enrichEntries(entries) { nickname -> seen.add(nickname); null }
        assertEquals(listOf("甲", "乙"), seen)
    }

    // ── 4. 看门狗预算 ────────────────────────────────────────────────────────

    @Test
    fun `computeExtractionTimeoutMs 覆盖 5 条 lead 的进主页-读-返回预算`() {
        // 不调这个常量，enrich 一上来就整轮 EXTRACTION_TIMEOUT 假失败（旧值 20s，
        // 光 5 条 lead 的往返就 100s）。
        val budget = DouyinCollectService.computeExtractionTimeoutMs()
        assertTrue(
            "看门狗预算 $budget ms 必须 >= 5 条 lead × 20s 往返 = 100s",
            budget >= 100_000L,
        )
    }

    @Test
    fun `computeExtractionTimeoutMs 随 lead 数线性增长且含基础提取预算`() {
        val base = DouyinCollectService.computeExtractionTimeoutMs(maxLeads = 0)
        val five = DouyinCollectService.computeExtractionTimeoutMs(maxLeads = 5)
        assertTrue("0 条 lead 时仍要保留原有的基础提取预算（>=20s）", base >= 20_000L)
        assertEquals(
            "每条 lead 预算必须恰好线性叠加",
            5 * DouyinCollectService.PER_LEAD_ENRICH_TIMEOUT_MS,
            five - base,
        )
    }

    @Test
    fun `看门狗必须早于 STUCK_STATE_RESET 触发，否则 busy-guard 先复位、任务永远收不到终态`() {
        assertTrue(
            "EXTRACTION_TIMEOUT(${DouyinCollectService.computeExtractionTimeoutMs()}) " +
                "必须 < STUCK_STATE_RESET(${DouyinCollectService.STUCK_STATE_RESET_MS})",
            DouyinCollectService.computeExtractionTimeoutMs() < DouyinCollectService.STUCK_STATE_RESET_MS,
        )
    }

    @Test
    fun `单条 lead 硬超时预算不得超过单卡取链预算量级（PER_CARD_TIMEOUT_MS）`() {
        // 进主页+等渲染+BACK 比"分享面板→剪贴板取链"轻，预算不该更大。
        assertTrue(
            DouyinCollectService.PER_LEAD_ENRICH_TIMEOUT_MS <= DouyinCollectService.PER_CARD_TIMEOUT_MS,
        )
    }
}
