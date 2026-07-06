package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sprint 07060927-douyin-dm-warmup-search — Golden Path Step 2-6 纯函数合同。
 *
 * 三块纯逻辑，完全脱离 Android 框架（无 AccessibilityNodeInfo/Context 等依赖），
 * 可直接用 JUnit 在 JVM 上跑，替换 `DouyinDmOutreachService.openProfile()` 前先落地判定标准：
 *
 * 1. `matchProfileByDouyinId` — 抖音号精确搜索定位主页（唯一匹配/零匹配/多匹配歧义）
 * 2. `needsFollowClick` / `needsLikeClick` — 关注/点赞按钮态判断（找不到按钮尽力而为跳过）
 * 3. `isLeadTimedOut` — 单 lead 90 秒超时熔断（区别于 failed）
 * 4. `isFollowRateLimited` / `isLikeRateLimited` — 关注/点赞每小时频控（1 小时滑动窗口，
 *    独立于既有 `classifyOutcome` 的私信频控——PRD NFR"关注 ≤10 次/小时，点赞 ≤15 次/小时"）
 *
 * DouyinDmOutreachService 尚未提供这些函数（TDD Red）— Generator 需要在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt
 * 的 companion object 里新增：
 *   - `internal enum class ProfileMatchResult { UNIQUE, NO_MATCH, AMBIGUOUS }`
 *   - `internal fun matchProfileByDouyinId(searchResults: List<String>, targetDouyinId: String): ProfileMatchResult`
 *   - `internal fun needsFollowClick(buttonText: String?): Boolean`
 *   - `internal fun needsLikeClick(buttonText: String?): Boolean`
 *   - `internal fun isLeadTimedOut(elapsedMs: Long, limitMs: Long = 90_000L): Boolean`
 *   - `internal fun isFollowRateLimited(followTimestampsMs: List<Long>, nowMs: Long, limit: Int = 10, windowMs: Long = 3_600_000L): Boolean`
 *   - `internal fun isLikeRateLimited(likeTimestampsMs: List<Long>, nowMs: Long, limit: Int = 15, windowMs: Long = 3_600_000L): Boolean`
 *
 * 频控判定标准：统计 `(nowMs - windowMs, nowMs]` 滑动窗口内的历史动作时间戳数量，
 * 数量 >= limit 时判定为限流（本次动作应跳过，不阻塞主流程，不做重试/排队）；
 * 窗口外（超过 1 小时前）的历史时间戳不计入本次判定。
 */
class DouyinDmWarmupSearchLogicTest {

    // ── matchProfileByDouyinId ───────────────────────────────────────────────

    @Test
    fun `matches exactly one profile by exact douyin id -> UNIQUE`() {
        val results = listOf("douyin_other_1", "douyin_target_123", "douyin_other_2")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.UNIQUE,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    @Test
    fun `zero matches -> NO_MATCH`() {
        val results = listOf("douyin_other_1", "douyin_other_2")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.NO_MATCH,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    @Test
    fun `empty search results -> NO_MATCH`() {
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.NO_MATCH,
            DouyinDmOutreachService.matchProfileByDouyinId(emptyList(), "douyin_target_123"),
        )
    }

    @Test
    fun `multiple identical matches -> AMBIGUOUS`() {
        val results = listOf("douyin_target_123", "douyin_other_1", "douyin_target_123")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.AMBIGUOUS,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    @Test
    fun `partial substring match does not count as exact match`() {
        // 精确匹配完整字符串——"douyin_target_123456" 包含目标串但不完全相等，不能算命中
        val results = listOf("douyin_target_123456")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.NO_MATCH,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    // ── needsFollowClick ──────────────────────────────────────────────────────

    @Test
    fun `follow button text 关注 needs click`() {
        assertTrue(DouyinDmOutreachService.needsFollowClick("关注"))
    }

    @Test
    fun `follow button text 已关注 does not need click`() {
        assertFalse(DouyinDmOutreachService.needsFollowClick("已关注"))
    }

    @Test
    fun `null follow button (not found) does not need click`() {
        // 找不到关注按钮/加载超时 → 尽力而为跳过，不阻塞
        assertFalse(DouyinDmOutreachService.needsFollowClick(null))
    }

    // ── needsLikeClick ────────────────────────────────────────────────────────

    @Test
    fun `like button text 点赞 needs click`() {
        assertTrue(DouyinDmOutreachService.needsLikeClick("点赞"))
    }

    @Test
    fun `like button text 已赞 does not need click`() {
        assertFalse(DouyinDmOutreachService.needsLikeClick("已赞"))
    }

    @Test
    fun `null like button (no artwork or follow-only profile) does not need click`() {
        // 已点赞/无作品可点赞/主页仅关注可见 → 尽力而为跳过，不阻塞
        assertFalse(DouyinDmOutreachService.needsLikeClick(null))
    }

    // ── isLeadTimedOut ────────────────────────────────────────────────────────

    @Test
    fun `elapsed time over 90 seconds is timed out`() {
        assertTrue(DouyinDmOutreachService.isLeadTimedOut(elapsedMs = 90_001L))
    }

    @Test
    fun `elapsed time exactly at 90 second boundary is not timed out`() {
        // PRD 用词"超过 90 秒"= 严格大于，边界值恰好 90000ms 不算超时
        assertFalse(DouyinDmOutreachService.isLeadTimedOut(elapsedMs = 90_000L))
    }

    @Test
    fun `elapsed time under 90 seconds is not timed out`() {
        assertFalse(DouyinDmOutreachService.isLeadTimedOut(elapsedMs = 45_000L))
    }

    // ── isFollowRateLimited（关注 ≤10 次/小时，1 小时滑动窗口）───────────────────

    @Test
    fun `follow count under hourly limit is not rate limited`() {
        val now = 10_000_000L
        // 9 次关注时间戳，均在窗口内（过去 1 小时以内）
        val timestamps = (1..9).map { now - it * 60_000L }
        assertFalse(DouyinDmOutreachService.isFollowRateLimited(timestamps, now))
    }

    @Test
    fun `follow count exactly at hourly limit is rate limited`() {
        val now = 10_000_000L
        // 恰好 10 次关注时间戳，均在窗口内 -> 达到上限即判定限流
        val timestamps = (1..10).map { now - it * 60_000L }
        assertTrue(DouyinDmOutreachService.isFollowRateLimited(timestamps, now))
    }

    @Test
    fun `follow count over hourly limit is rate limited`() {
        val now = 10_000_000L
        val timestamps = (1..11).map { now - it * 60_000L }
        assertTrue(DouyinDmOutreachService.isFollowRateLimited(timestamps, now))
    }

    @Test
    fun `follow timestamps outside 1 hour window are not counted`() {
        val now = 10_000_000L
        // 9 条窗口外（超过 1 小时前）历史 + 9 条窗口内 -> 窗口内计数仅 9，未达上限
        val outsideWindow = (1..9).map { now - 3_600_000L - it * 60_000L }
        val insideWindow = (1..9).map { now - it * 60_000L }
        assertFalse(DouyinDmOutreachService.isFollowRateLimited(outsideWindow + insideWindow, now))
    }

    // ── isLikeRateLimited（点赞 ≤15 次/小时，1 小时滑动窗口）─────────────────────

    @Test
    fun `like count under hourly limit is not rate limited`() {
        val now = 10_000_000L
        val timestamps = (1..14).map { now - it * 60_000L }
        assertFalse(DouyinDmOutreachService.isLikeRateLimited(timestamps, now))
    }

    @Test
    fun `like count exactly at hourly limit is rate limited`() {
        val now = 10_000_000L
        val timestamps = (1..15).map { now - it * 60_000L }
        assertTrue(DouyinDmOutreachService.isLikeRateLimited(timestamps, now))
    }

    @Test
    fun `like count over hourly limit is rate limited`() {
        val now = 10_000_000L
        val timestamps = (1..16).map { now - it * 60_000L }
        assertTrue(DouyinDmOutreachService.isLikeRateLimited(timestamps, now))
    }

    @Test
    fun `like timestamps outside 1 hour window are not counted`() {
        val now = 10_000_000L
        val outsideWindow = (1..14).map { now - 3_600_000L - it * 60_000L }
        val insideWindow = (1..14).map { now - it * 60_000L }
        assertFalse(DouyinDmOutreachService.isLikeRateLimited(outsideWindow + insideWindow, now))
    }
}
