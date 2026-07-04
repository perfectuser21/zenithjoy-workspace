package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

class NodeExtractorTest {

    private fun node(text: String = "", cd: String = "", id: String = "") =
        NodeExtractor.NodeInfo(text, cd, id)

    // ── resource-id 精确匹配 ──────────────────────────────────────────────────

    @Test
    fun `extracts comment by resource-id pairing`() {
        val nodes = listOf(
            node(text = "美食博主小李", id = "com.ss.android.ugc.aweme:id/tv_username"),
            node(text = "求推荐几个靠谱的经纪公司", id = "com.ss.android.ugc.aweme:id/tv_comment_content"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("美食博主小李", result[0].commenterId)
        assertEquals("求推荐几个靠谱的经纪公司", result[0].text)
    }

    @Test
    fun `extracts multiple comments by resource-id in sequence`() {
        val nodes = listOf(
            node(text = "小王", id = "com.ss.android.ugc.aweme:id/tv_username"),
            node(text = "怎么联系你们", id = "com.ss.android.ugc.aweme:id/tv_comment_content"),
            node(text = "小张", id = "com.ss.android.ugc.aweme:id/tv_username"),
            node(text = "有没有官网", id = "com.ss.android.ugc.aweme:id/tv_comment_content"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(2, result.size)
        assertEquals("小王", result[0].commenterId)
        assertEquals("怎么联系你们", result[0].text)
        assertEquals("小张", result[1].commenterId)
        assertEquals("有没有官网", result[1].text)
    }

    @Test
    fun `resource-id match ignores nickname with blank content`() {
        val nodes = listOf(
            node(text = "小王", id = "com.ss.android.ugc.aweme:id/tv_username"),
            node(text = "", id = "com.ss.android.ugc.aweme:id/tv_comment_content"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertTrue(result.isEmpty())
    }

    // ── 结构启发式 fallback（resource-id 未命中时） ───────────────────────────

    @Test
    fun `falls back to structural heuristic when no resource-id matches`() {
        val nodes = listOf(
            node(text = "抖音用户9527"),
            node(text = "求问这家公司靠谱吗"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("抖音用户9527", result[0].commenterId)
        assertEquals("求问这家公司靠谱吗", result[0].text)
    }

    @Test
    fun `structural heuristic skips meta words like reply and time`() {
        val nodes = listOf(
            node(text = "小赵"),
            node(text = "太贵了吧"),
            node(text = "3天前"),
            node(text = "回复"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("小赵", result[0].commenterId)
        assertEquals("太贵了吧", result[0].text)
    }

    @Test
    fun `structural heuristic rejects overly long nickname candidate`() {
        val nodes = listOf(
            node(text = "这是一段非常非常非常非常非常非常非常非常长的不像昵称的文本"),
            node(text = "正文"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertTrue(result.isEmpty())
    }

    @Test
    fun `empty nodes returns empty comment list`() {
        val result = NodeExtractor.extractComments(emptyList())
        assertTrue(result.isEmpty())
    }

    // ── RandomDelay ───────────────────────────────────────────────────────────

    @Test
    fun `random delay sample is within range`() {
        repeat(50) {
            val delay = RandomDelay.sample(RandomDelay.CLICK_MS)
            assertTrue(delay >= RandomDelay.CLICK_MS.first && delay <= RandomDelay.CLICK_MS.last)
        }
    }

    @Test
    fun `random delay varies across samples`() {
        val samples = (1..20).map { RandomDelay.sample(RandomDelay.NAV_MS) }.toSet()
        assertTrue("expected variance across 20 samples", samples.size > 1)
    }
}
