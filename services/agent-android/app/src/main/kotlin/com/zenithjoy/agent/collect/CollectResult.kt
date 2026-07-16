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
/**
 * @property commenterId 评论人昵称（评论面板 resource-id=.../title 的文本）。
 * @property douyinId 评论人的【真实抖音号】，由 DouyinCollectService.enrichCommentsWithDouyinId
 *   点头像进主页读出（Seg3 方案 B′）。读不到就是 null——绝不回退成昵称/URL 顶替。
 *   派单段（acquisition-dispatch.ts）拿它发给设备做精确搜索定位；发 profile_url 的老做法
 *   会让设备把 URL 当抖音号搜 → 必然 NO_MATCH。
 */
data class CommentEntry(
    val commenterId: String,
    val text: String,
    val douyinId: String? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "commenter_id" to commenterId,
        "text" to text,
        // 字段恒在（读不到时为 null）：省略会让服务端分不清"没读到"和"老版本 agent 没这能力"。
        "douyin_id" to douyinId,
    )

    /**
     * POST /api/acquisition/collect/report 的 commenters[] 字段名（nickname/comment_text）
     * 跟 toMap() 对齐的 /comment-score-result 老协议（commenter_id/text）不是同一套命名。
     *
     * 真机复现(2026-07-16)：Stage2 上报旧实现只塞了 nickname/comment_text，douyinId 从没
     * 进过这个 map——即使 Seg3 点头像进主页真读到了号，也在这一步被吃掉，落库侧
     * acquisition_leads.douyin_id 永远 NULL，Seg4 派单永远无号可发只能退回旧 bug
     * （把 profile_url 当抖音号搜 → NO_MATCH）。douyin_id 字段恒在（读不到为 null），
     * 理由同 toMap()。
     */
    fun toCollectReportMap(): Map<String, Any?> = mapOf(
        "nickname" to commenterId,
        "comment_text" to text,
        "douyin_id" to douyinId,
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
