package com.zenithjoy.agent.collect

/**
 * 抖音评论区采集结果。
 *
 * 采集目标不是视频作者本人，是评论区里给这条爆款视频留言的人——
 * 这些人主动对该话题表达兴趣，是精准获客线索；作者本人只是搜索关键词定位到的参照账号。
 *
 * 字段对齐服务端已有接口 POST /api/acquisition/comment-score-result
 * （commenter_id / text），复用同一份 keyword_task_id 语义。
 */
data class CommentEntry(
    val commenterId: String,
    val text: String,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "commenter_id" to commenterId,
        "text" to text,
    )
}

data class CollectResult(
    val ok: Boolean,
    val keyword: String,
    val videoUrl: String = "",
    val comments: List<CommentEntry> = emptyList(),
    val error: String = "",
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "ok" to ok,
        "keyword" to keyword,
        "video_url" to videoUrl,
        "comments" to comments.map { it.toMap() },
        "error" to error.ifEmpty { null },
    )

    /**
     * 服务端唯一能接住评论数据的端点是 POST /api/acquisition/comment-score-result
     * （/api/agent/task-result 不存在）。keywordTaskId 对应 acquisition_keyword_tasks.id，
     * 由派发 android_douyin 任务的一侧传入（ws0 collect_task / ws1 task.task_id）。
     */
    fun toCommentScoreResultPayload(keywordTaskId: String): Map<String, Any?> = mapOf(
        "keyword_task_id" to keywordTaskId,
        "video_url" to videoUrl,
        "comments" to comments.map { it.toMap() },
    )
}
