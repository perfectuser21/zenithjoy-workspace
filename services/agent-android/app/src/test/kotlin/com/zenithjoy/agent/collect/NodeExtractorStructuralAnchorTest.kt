package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 守卫：抖音新版评论面板条目**无 resource-id、无 content-desc**（Brain task 28cee213，2026-08-16
 * 4号机 MAA-AN00 uiautomator 真机 dump）：昵称/正文/日期都是裸 TextView，只有「回复」文本与
 * 「赞N,未选中」content-desc 稳定。既有 resourceId/contentDesc 双锚全部失效 → extracted 0 comments
 * → 步3 Lead 恒 0（全 staging 自 07-29 起无设备抓到评论）。本测试用真实 dump（DFS 顺序原样）
 * 锁定：结构锚点必须把三条真实评论抓出来，且不混入标题栏/输入框/「展开N条回复」等噪音。
 */
class NodeExtractorStructuralAnchorTest {

    private fun n(text: String, cd: String, id: String) = NodeExtractor.NodeInfo(text, cd, id)

    /** 2026-08-16 4号机真机 dump：视频 7628954615198928138 评论面板，72 节点原样。 */
    private val realDump20260816 = listOf(
        n("", "", ""),
        n("", "", "com.ss.android.ugc.aweme:id/jm-"),
        n("", "", "com.ss.android.ugc.aweme:id/x-j"),
        n("", "", ""),
        n("", "", ""),
        n("8383条评论", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("唯一", "", ""),
        n("", "", ""),
        n("新房装修，到底选择自主装修，还是全权托付给装修公司？", "", ""),
        n("3天前", "", ""),
        n(" · 广东", "", ""),
        n("回复", "", ""),
        n("", "", ""),
        n("", "赞0,未选中", ""),
        n("", "", ""),
        n("", "点踩", ""),
        n("", "", ""),
        n("", "", ""),
        n("展开1条回复", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("总是低血糖", "", ""),
        n("", "", ""),
        n("电工师傅听到你要留一个总控开关后的表情", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("04-20", "", ""),
        n(" · 新疆", "", ""),
        n("回复", "", ""),
        n("", "", ""),
        n("", "赞29005,未选中", ""),
        n("2.9万", "", ""),
        n("", "", ""),
        n("", "点踩", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("路上", "", ""),
        n("", "", ""),
        n("总开关断了之后，回家发现冰箱里肉菜全臭了[黑脸]", "", ""),
        n("", "", ""),
        n("05-14", "", ""),
        n(" · 四川", "", ""),
        n("回复", "", ""),
        n("", "", ""),
        n("", "赞10,未选中", ""),
        n("10", "", ""),
        n("", "", ""),
        n("", "点踩", ""),
        n("", "", ""),
        n("展开228条回复", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("", "", ""),
        n("爱评论的人，运气不会差", "", ""),
        n("", "", ""),
        n("", "image", ""),
        n("", "", ""),
        n("", "at", ""),
        n("", "", ""),
        n("", "emoji", ""),
        n("", "", "com.ss.android.ugc.aweme:id/2w8"),
        n("", "放大评论区", "com.ss.android.ugc.aweme:id/kie"),
        n("", "关闭", "com.ss.android.ugc.aweme:id/back_btn"),    )

    @Test
    fun `no-id no-desc comment items are extracted via structural anchor`() {
        val comments = NodeExtractor.extractComments(realDump20260816)
        val pairs = comments.map { it.commenterId to it.text }
        assertTrue("应抓到『唯一』的评论: $pairs", pairs.contains("唯一" to "新房装修，到底选择自主装修，还是全权托付给装修公司？"))
        assertTrue("应抓到『总是低血糖』的评论: $pairs", pairs.contains("总是低血糖" to "电工师傅听到你要留一个总控开关后的表情"))
        assertTrue("应抓到楼中楼『路上』的评论: $pairs", pairs.contains("路上" to "总开关断了之后，回家发现冰箱里肉菜全臭了[黑脸]"))
    }

    @Test
    fun `structural anchor does not emit metadata garbage`() {
        val comments = NodeExtractor.extractComments(realDump20260816)
        val garbage = listOf("8383条评论", "展开1条回复", "展开228条回复", "爱评论的人，运气不会差", "回复", "3天前", "04-20", "05-14", " · 广东", " · 新疆", " · 四川", "2.9万", "10")
        for (c in comments) {
            assertTrue("昵称不该是元数据: ${c.commenterId}", garbage.none { it == c.commenterId })
            assertTrue("正文不该是元数据: ${c.text}", garbage.none { it == c.text })
            assertTrue("昵称与正文不能相同: $c", c.commenterId != c.text)
        }
        assertEquals("真实 dump 恰好三条评论（含一条楼中楼）", 3, comments.size)
    }
}
