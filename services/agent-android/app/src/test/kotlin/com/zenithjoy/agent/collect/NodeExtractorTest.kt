package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

class NodeExtractorTest {

    private fun node(text: String = "", cd: String = "", id: String = "") =
        NodeExtractor.NodeInfo(text, cd, id)

    // ── 昵称 ──────────────────────────────────────────────────────────────────

    @Test
    fun `extracts nickname by resource-id`() {
        val nodes = listOf(
            node(text = "美食博主小李", id = "com.ss.android.ugc.aweme:id/tv_user_nickname"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("美食博主小李", result.nickname)
    }

    @Test
    fun `extracts nickname from contentDescription 的主页 suffix`() {
        val nodes = listOf(
            node(cd = "小王的主页"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("小王", result.nickname)
    }

    @Test
    fun `ignores 的主页 suffix that is too long`() {
        val nodes = listOf(
            node(cd = "这是一段非常非常非常非常非常非常非常非常非常非常非常长的用户名的主页"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("", result.nickname)
    }

    // ── 抖音号 ────────────────────────────────────────────────────────────────

    @Test
    fun `extracts douyin id by resource-id`() {
        val nodes = listOf(
            node(text = "douyin_user_123", id = "com.ss.android.ugc.aweme:id/tv_user_uniqueid"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("douyin_user_123", result.douyinId)
    }

    @Test
    fun `extracts douyin id from text prefix 抖音号`() {
        val nodes = listOf(
            node(text = "抖音号：abc_xyz_789"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("abc_xyz_789", result.douyinId)
    }

    @Test
    fun `extracts douyin id with colon variant`() {
        val nodes = listOf(
            node(text = "抖音号: my_id_456"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("my_id_456", result.douyinId)
    }

    // ── 粉丝数 ────────────────────────────────────────────────────────────────

    @Test
    fun `extracts followers by resource-id`() {
        val nodes = listOf(
            node(text = "12.8万", id = "com.ss.android.ugc.aweme:id/tv_fans_count"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("12.8万", result.followersCount)
    }

    @Test
    fun `extracts followers from contentDescription 粉丝 suffix`() {
        val nodes = listOf(
            node(cd = "5.2万 粉丝"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("5.2万", result.followersCount)
    }

    @Test
    fun `extracts followers via adjacent label node`() {
        val nodes = listOf(
            node(text = "99.9万"),
            node(text = "粉丝"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("99.9万", result.followersCount)
    }

    // ── 简介 ──────────────────────────────────────────────────────────────────

    @Test
    fun `extracts bio by resource-id`() {
        val nodes = listOf(
            node(text = "专注分享美食探店，记录生活中的美好瞬间", id = "com.ss.android.ugc.aweme:id/tv_user_desc"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("专注分享美食探店，记录生活中的美好瞬间", result.bio)
    }

    @Test
    fun `extracts bio by heuristic long text without social signals`() {
        val nodes = listOf(
            node(text = "关注", id = ""),
            node(text = "获赞 1.2万", id = ""),
            node(text = "专注记录每日健身过程，分享科学训练方法", id = ""),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("专注记录每日健身过程，分享科学训练方法", result.bio)
    }

    @Test
    fun `bio heuristic skips short texts`() {
        val nodes = listOf(
            node(text = "短文本", id = ""),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("", result.bio)
    }

    // ── 综合 ──────────────────────────────────────────────────────────────────

    @Test
    fun `full profile extraction`() {
        val nodes = listOf(
            node(text = "美食达人张三", id = "com.ss.android.ugc.aweme:id/tv_user_nickname"),
            node(text = "抖音号：zhangsansf2024"),
            node(text = "88.6万", id = "com.ss.android.ugc.aweme:id/tv_fans_count"),
            node(text = "每天分享一道家常菜，让厨房不再难为你，关注我不后悔", id = "com.ss.android.ugc.aweme:id/tv_user_desc"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("美食达人张三", result.nickname)
        assertEquals("zhangsansf2024", result.douyinId)
        assertEquals("88.6万", result.followersCount)
        assertEquals("每天分享一道家常菜，让厨房不再难为你，关注我不后悔", result.bio)
    }

    @Test
    fun `empty profile returns blank fields`() {
        val nodes = listOf(
            node(text = "关注"),
            node(text = "3"),
        )
        val result = NodeExtractor.extract(nodes)
        assertEquals("", result.nickname)
        assertEquals("", result.douyinId)
        assertEquals("", result.followersCount)
        assertEquals("", result.bio)
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
