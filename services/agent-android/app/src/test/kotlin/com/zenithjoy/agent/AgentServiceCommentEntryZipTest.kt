package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * zipCommentEntries —— DouyinCollectService.onCollectResult / collectResultReceiver
 * 两条回调路径把 CommentEntry 拆成平行数组（IPC/Intent extras 只能带原始类型数组）
 * 重建回来那一步（TDD Red 先行）。
 *
 * 真机复现(2026-07-16)：这两条路径此前只重建 commenterId/text，douyinId 参数
 * 加入回调签名之前压根没地方接——真机验证 logcat 明明打出
 * "enriched douyinId 2/3 leads"，最终落库的 lead 却全是 douyin_id=NULL，
 * 跟服务端 /collect/report 收不收 douyin_id 字段完全无关，根本没发出去过。
 */
class AgentServiceCommentEntryZipTest {

    @Test
    fun `按下标对齐重建 commenterId text douyinId`() {
        val result = AgentService.zipCommentEntries(
            commenterIds = listOf("小叶子", "小王"),
            commentTexts = listOf("怎么联系你们", "有没有官网"),
            douyinIds = listOf("1689210742", ""),
        )

        assertEquals(2, result.size)
        assertEquals("小叶子", result[0].commenterId)
        assertEquals("怎么联系你们", result[0].text)
        assertEquals("1689210742", result[0].douyinId)
        assertEquals("小王", result[1].commenterId)
        assertEquals("有没有官网", result[1].text)
        assertNull("空串哨兵值必须解回 null，绝不当真号使", result[1].douyinId)
    }

    @Test
    fun `douyinIds 全空串（真机复现前的老行为）→ 全部 douyinId=null，不炸不丢条`() {
        val result = AgentService.zipCommentEntries(
            commenterIds = listOf("小叶子"),
            commentTexts = listOf("怎么联系你们"),
            douyinIds = listOf(""),
        )
        assertEquals(1, result.size)
        assertNull(result[0].douyinId)
    }

    @Test
    fun `douyinIds 数组比 commenterIds 短（老版本 agent 兼容）→ 缺的按 null 补`() {
        val result = AgentService.zipCommentEntries(
            commenterIds = listOf("小叶子", "小王"),
            commentTexts = listOf("怎么联系你们", "有没有官网"),
            douyinIds = listOf("1689210742"), // 只有 1 个，第 2 条缺失
        )
        assertEquals(2, result.size)
        assertEquals("1689210742", result[0].douyinId)
        assertNull("douyinIds 数组比 commenterIds 短时不该抛异常，缺的按 null 补", result[1].douyinId)
    }

    @Test
    fun `commentTexts 缺失下标按空字符串补（既有行为不回归）`() {
        val result = AgentService.zipCommentEntries(
            commenterIds = listOf("小叶子", "胡**v"),
            commentTexts = listOf("怎么联系你们"),
            douyinIds = listOf("", ""),
        )
        assertEquals(2, result.size)
        assertEquals("", result[1].text)
    }

    @Test
    fun `空列表返回空列表`() {
        val result = AgentService.zipCommentEntries(emptyList(), emptyList(), emptyList())
        assertEquals(0, result.size)
    }
}
