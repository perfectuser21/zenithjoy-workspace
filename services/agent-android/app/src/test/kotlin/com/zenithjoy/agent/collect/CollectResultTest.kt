package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

// 守卫：AgentService 曾经把评论结果 POST 到不存在的 /api/agent/task-result，
// 数据从未真正到达服务端。这里锁死 payload 形状必须匹配服务端真实存在的
// POST /api/acquisition/comment-score-result（keyword_task_id/video_url/comments）。
class CollectResultTest {

    @Test
    fun `comment-score-result payload uses keyword_task_id not task_id`() {
        val result = CollectResult(
            ok = true,
            keyword = "麻婆豆腐",
            videoUrl = "https://www.douyin.com/video/123",
            comments = listOf(CommentEntry(commenterId = "小王", text = "怎么联系你们")),
        )
        val payload = result.toCommentScoreResultPayload("kw-task-uuid-1")

        assertEquals("kw-task-uuid-1", payload["keyword_task_id"])
        assertEquals("https://www.douyin.com/video/123", payload["video_url"])
        assertFalse("payload 不能带旧的 task_id 字段", payload.containsKey("task_id"))
        assertFalse("payload 不能再嵌套旧的 result/platform 包装", payload.containsKey("platform"))

        @Suppress("UNCHECKED_CAST")
        val comments = payload["comments"] as List<Map<String, Any?>>
        assertEquals(1, comments.size)
        assertEquals("小王", comments[0]["commenter_id"])
        assertEquals("怎么联系你们", comments[0]["text"])
    }

    // Seg3 方案 B′：抓评论时点头像进主页读出的真实抖音号必须随 payload 上行，
    // 否则派单侧永远拿不到号，只能退回发 profile_url → 设备当抖音号搜 → 必然 NO_MATCH。
    @Test
    fun `comment-score-result payload 带 douyin_id（Seg3 回填的真实抖音号）`() {
        val result = CollectResult(
            ok = true,
            keyword = "花架",
            videoUrl = "https://www.douyin.com/video/123",
            comments = listOf(
                CommentEntry(commenterId = "小叶子", text = "怎么联系你们", douyinId = "1689210742"),
            ),
        )

        @Suppress("UNCHECKED_CAST")
        val comments = result.toCommentScoreResultPayload("kw-task-uuid-3")["comments"] as List<Map<String, Any?>>
        assertEquals("1689210742", comments[0]["douyin_id"])
        assertEquals("小叶子", comments[0]["commenter_id"])
    }

    @Test
    fun `douyin_id 读不到时 payload 里是 null 且字段仍在（宁可空不可猜，绝不省略字段）`() {
        // 字段必须在：省略会让服务端分不清"没读到"和"老版本 agent 没这个能力"。
        val result = CollectResult(
            ok = true,
            keyword = "花架",
            comments = listOf(CommentEntry(commenterId = "小叶子", text = "怎么联系你们")),
        )

        @Suppress("UNCHECKED_CAST")
        val comments = result.toCommentScoreResultPayload("kw-task-uuid-4")["comments"] as List<Map<String, Any?>>
        assertTrue("douyin_id 字段必须存在", comments[0].containsKey("douyin_id"))
        assertNull("读不到就得是 null，绝不能造假/回退成昵称或 URL", comments[0]["douyin_id"])
    }

    @Test
    fun `comment-score-result payload with empty comments still includes keyword_task_id`() {
        val result = CollectResult(ok = false, keyword = "麻婆豆腐", error = "SEARCH_TIMEOUT")
        val payload = result.toCommentScoreResultPayload("kw-task-uuid-2")

        assertEquals("kw-task-uuid-2", payload["keyword_task_id"])
        @Suppress("UNCHECKED_CAST")
        val comments = payload["comments"] as List<Map<String, Any?>>
        assertTrue(comments.isEmpty())
    }
}
