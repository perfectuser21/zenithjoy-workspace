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
 *
 * DouyinDmOutreachService 尚未提供这三块函数（TDD Red）— Generator 需要在
 * services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt
 * 的 companion object 里新增：
 *   - `internal enum class ProfileMatchResult { UNIQUE, NO_MATCH, AMBIGUOUS }`
 *   - `internal fun matchProfileByDouyinId(searchResults: List<String>, targetDouyinId: String): ProfileMatchResult`
 *   - `internal fun needsFollowClick(buttonText: String?): Boolean`
 *   - `internal fun needsLikeClick(buttonText: String?): Boolean`
 *   - `internal fun isLeadTimedOut(elapsedMs: Long, limitMs: Long = 90_000L): Boolean`
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
}
