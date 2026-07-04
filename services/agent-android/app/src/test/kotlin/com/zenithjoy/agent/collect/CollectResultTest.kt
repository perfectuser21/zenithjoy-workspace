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
