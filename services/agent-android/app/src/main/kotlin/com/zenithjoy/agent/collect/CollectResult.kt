package com.zenithjoy.agent.collect

/**
 * 抖音主页采集结果。
 * 字段对齐服务端 keyword_collect_results 表：nickname / douyin_id / followers / bio。
 */
data class CollectResult(
    val ok: Boolean,
    val keyword: String,
    val nickname: String = "",
    val douyinId: String = "",
    val followersCount: String = "",
    val bio: String = "",
    val profileUrl: String = "",
    val error: String = "",
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "ok" to ok,
        "keyword" to keyword,
        "nickname" to nickname,
        "douyin_id" to douyinId,
        "followers_count" to followersCount,
        "bio" to bio,
        "profile_url" to profileUrl,
        "error" to error.ifEmpty { null },
    )
}
