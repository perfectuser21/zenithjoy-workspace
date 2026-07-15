package com.zenithjoy.agent.collect

import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test
import org.w3c.dom.Element

class NodeExtractorTest {

    private fun node(text: String = "", cd: String = "", id: String = "") =
        NodeExtractor.NodeInfo(text, cd, id)

    private val pkg = "com.ss.android.ugc.aweme:id"

    private fun avatar(nick: String) = node(cd = "${nick}的头像", id = "$pkg/avatar")
    private fun title(nick: String) = node(text = nick, id = "$pkg/title")
    private fun content(text: String) = node(text = text, id = "$pkg/content")
    private fun authorBadge() = node(text = "作者", id = "$pkg/eyo")

    /**
     * 解析真机 uiautomator dump，按文档序（== DFS 前序，与生产
     * NodeTreeFlattener.flattenDfs 喂给 extractComments 的顺序一致）摊平成 NodeInfo 列表。
     */
    private fun loadFixtureNodes(name: String): List<NodeExtractor.NodeInfo> {
        val stream = requireNotNull(javaClass.getResourceAsStream("/fixtures/$name")) {
            "fixture not found on test classpath: /fixtures/$name"
        }
        val doc = stream.use {
            DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it)
        }
        val out = mutableListOf<NodeExtractor.NodeInfo>()
        fun walk(el: Element) {
            if (el.tagName == "node") {
                out.add(
                    NodeExtractor.NodeInfo(
                        text = el.getAttribute("text"),
                        contentDescription = el.getAttribute("content-desc"),
                        resourceId = el.getAttribute("resource-id"),
                    ),
                )
            }
            val kids = el.childNodes
            for (i in 0 until kids.length) {
                val k = kids.item(i)
                if (k is Element) walk(k)
            }
        }
        walk(doc.documentElement)
        return out
    }

    // ── 真机 fixture 钉死（2026-07-15 dump，235 节点） ──────────────────────────
    //
    // 真机 id = avatar / title / content / eyo。item 结构 = avatar → title → [eyo] → content，
    // 在 DFS 前序里天然连续，用 avatar 当分隔符切段即可。

    @Test
    fun `extracts exactly the two real comments from real-machine dump`() {
        val nodes = loadFixtureNodes("douyin-comment-panel-20260715.xml")
        val result = NodeExtractor.extractComments(nodes)

        assertEquals("真机 dump 里只有 2 条真实网友评论，实际=$result", 2, result.size)
        assertEquals("小叶子", result[0].commenterId)
        assertEquals("你这个地上铺的是复合地板吗", result[0].text)
        assertEquals("LENTER心疼姑舅", result[1].commenterId)
        assertEquals("预算10万求推荐", result[1].text)
    }

    @Test
    fun `real-machine dump extraction contains no metadata garbage`() {
        val nodes = loadFixtureNodes("douyin-comment-panel-20260715.xml")
        val result = NodeExtractor.extractComments(nodes)
        val allText = result.flatMap { listOf(it.commenterId, it.text) }

        // 线上事故实录：这些元数据 / 商品卡 / tab 栏文本曾被当成 lead 抓进库。
        val garbage = listOf(
            "已售200+",
            "作者",
            "购物",
            "评论 94",
            "客厅多层花架",
            "视频同款及更多好物在橱窗里 详情",
        )
        for (g in garbage) {
            assertFalse(
                "垃圾文本不该出现在抓取结果里: $g，实际=$result",
                allText.any { it.contains(g) },
            )
        }
        // 胡**v 的 item 不完整（正文滚出屏幕）：宁可丢，不能瞎配。
        assertFalse("不完整 item 不该产出，实际=$result", allText.any { it.contains("胡**v") })
    }

    // ── 宁可空，不可猜：锚定不到就返回空，不许启发式配对 ───────────────────────────

    @Test
    fun `returns empty rather than guessing when no avatar or title anchors present`() {
        // 模拟抖音改版 / id 猜错：全是"看起来像昵称 + 像正文"的相邻文本，但没有锚点。
        val nodes = listOf(
            node(text = "小叶子"),
            node(text = "你这个地上铺的是复合地板吗"),
            node(text = "客厅多层花架"),
            node(text = "已售200+"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertTrue(
            "没有 avatar/title 锚点时必须返回空（宁可空，不可猜），实际=$result",
            result.isEmpty(),
        )
    }

    // ── avatar 锚定的基本行为 ──────────────────────────────────────────────────

    @Test
    fun `extracts multiple comments anchored by avatar`() {
        val nodes = listOf(
            avatar("小王"), title("小王"), content("怎么联系你们"),
            avatar("小张"), title("小张"), content("有没有官网"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(2, result.size)
        assertEquals("小王", result[0].commenterId)
        assertEquals("怎么联系你们", result[0].text)
        assertEquals("小张", result[1].commenterId)
        assertEquals("有没有官网", result[1].text)
    }

    @Test
    fun `skips author own comment marked by eyo badge`() {
        val nodes = listOf(
            avatar("波本气泡水"), title("波本气泡水"), authorBadge(), content("推荐啥子[捂脸]"),
            avatar("小叶子"), title("小叶子"), content("你这个地上铺的是复合地板吗"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals("博主自己的评论不是 lead，实际=$result", 1, result.size)
        assertEquals("小叶子", result[0].commenterId)
    }

    @Test
    fun `ignores incomplete item without content`() {
        val nodes = listOf(
            avatar("小王"), title("小王"), content("怎么联系你们"),
            avatar("胡**v"), title("胡**v"), // 正文滚出屏幕
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("小王", result[0].commenterId)
    }

    @Test
    fun `ignores orphan nodes before first avatar`() {
        val nodes = listOf(
            content(""), // 孤儿 content，真机 dump 里确实存在
            node(text = "7889条评论"),
            avatar("小王"), title("小王"), content("怎么联系你们"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("小王", result[0].commenterId)
        assertEquals("怎么联系你们", result[0].text)
    }

    @Test
    fun `ignores item whose content is blank`() {
        val nodes = listOf(
            avatar("小王"), title("小王"), content("   "),
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
