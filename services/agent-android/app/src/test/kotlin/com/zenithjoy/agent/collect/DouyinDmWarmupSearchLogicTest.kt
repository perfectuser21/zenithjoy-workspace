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
    fun `matches exactly one profile by exact douyin id yields UNIQUE`() {
        val results = listOf("douyin_other_1", "douyin_target_123", "douyin_other_2")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.UNIQUE,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    @Test
    fun `zero matches yields NO_MATCH`() {
        val results = listOf("douyin_other_1", "douyin_other_2")
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.NO_MATCH,
            DouyinDmOutreachService.matchProfileByDouyinId(results, "douyin_target_123"),
        )
    }

    @Test
    fun `empty search results yields NO_MATCH`() {
        assertEquals(
            DouyinDmOutreachService.ProfileMatchResult.NO_MATCH,
            DouyinDmOutreachService.matchProfileByDouyinId(emptyList(), "douyin_target_123"),
        )
    }

    @Test
    fun `multiple identical matches yields AMBIGUOUS`() {
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

    // ── verifyProfileMatchesDouyinId ─────────────────────────────────────────
    // 真机实测(抖音 39.4.0)：SearchResultActivity 的搜索结果列表【不进无障碍树】
    // (自定义/Lynx 渲染，dump 只见搜索框+tab)，所以老的 matchProfileByDouyinId(搜索结果文本)
    // 永远匹配不到人、反被搜索框回显的裸 id 骗成假 UNIQUE。新方案：坐标盲点顶部结果进主页，
    // 主页页面【进树】(含 "抖音号：<id>")，落地后用本函数验证点对了人——点错就中止，保证不误发。

    @Test
    fun `profile page containing 抖音号 prefix line matching target verifies true`() {
        val profileTexts = listOf("伯都呀伯都 ", "抖音号：133643315", "获赞", "发私信")
        assertTrue(DouyinDmOutreachService.verifyProfileMatchesDouyinId(profileTexts, "133643315"))
    }

    @Test
    fun `profile page with halfwidth colon also verifies`() {
        val profileTexts = listOf("某人", "抖音号:Zenithjoyai", "关注")
        assertTrue(DouyinDmOutreachService.verifyProfileMatchesDouyinId(profileTexts, "Zenithjoyai"))
    }

    @Test
    fun `wrong profile (different douyin id) fails verification`() {
        val profileTexts = listOf("别人", "抖音号：999999999", "发私信")
        assertFalse(DouyinDmOutreachService.verifyProfileMatchesDouyinId(profileTexts, "133643315"))
    }

    @Test
    fun `bare id echo without 抖音号 prefix does not verify (search box trap)`() {
        // 搜索框回显是裸 id "133643315"（无"抖音号"前缀），绝不能被当成主页验证通过
        assertFalse(DouyinDmOutreachService.verifyProfileMatchesDouyinId(listOf("133643315", "搜索"), "133643315"))
    }

    @Test
    fun `empty profile texts fail verification`() {
        assertFalse(DouyinDmOutreachService.verifyProfileMatchesDouyinId(emptyList(), "133643315"))
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

    @Test
    fun `follow button text 回关 needs click`() {
        // 真机(抖音39.4.0)实测：当"对方已关注你、你尚未关注对方"时，主页关注按钮文案是"回关"
        // (content-desc="回关" class=Button clickable=true)，不是"关注"。这也是"未关注→需关注"的
        // 动作态，必须点击，否则 warmup 关注在整类回关场景永远漏点(只认"关注"二字会漏掉)。
        assertTrue(DouyinDmOutreachService.needsFollowClick("回关"))
    }

    @Test
    fun `follow button text 相互关注 does not need click`() {
        // 已互关(对方关注你、你也关注了对方)→按钮文案"相互关注"，已是关注态，不再点击
        assertFalse(DouyinDmOutreachService.needsFollowClick("相互关注"))
    }

    // ── needsVideoLikeClick ──────────────────────────────────────────────────
    // 真机(抖音39.4.0)实测：作品网格页【没有】点赞按钮(只有"点赞数N"展示标签，clickable=false)，
    // 红心点赞只存在于【视频详情页 UltraDetailActivity】。红心按钮的 content-desc 是整句：
    //   未赞态 = "未点赞，喜欢13，按钮"    已赞态 = "已点赞，喜欢13，按钮"
    // 因此判定不是精确等于"点赞"，而是【content-desc 含"未点赞"才点】(含"已点赞"/找不到→跳过)。

    @Test
    fun `video like button 未点赞 desc needs click`() {
        assertTrue(DouyinDmOutreachService.needsVideoLikeClick("未点赞，喜欢13，按钮"))
    }

    @Test
    fun `video like button 已点赞 desc does not need click`() {
        assertFalse(DouyinDmOutreachService.needsVideoLikeClick("已点赞，喜欢14，按钮"))
    }

    @Test
    fun `null video like button (not found) does not need click`() {
        // 找不到红心/视频页未加载出来 → 尽力而为跳过，不阻塞
        assertFalse(DouyinDmOutreachService.needsVideoLikeClick(null))
    }

    @Test
    fun `grid 点赞数 label is not a like button and does not need click`() {
        // 作品网格的"点赞数14"是展示标签(clickable=false)，绝不能被当成未赞态误点
        assertFalse(DouyinDmOutreachService.needsVideoLikeClick("点赞数14"))
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
