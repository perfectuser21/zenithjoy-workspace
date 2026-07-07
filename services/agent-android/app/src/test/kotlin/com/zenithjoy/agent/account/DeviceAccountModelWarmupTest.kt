package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Sprint 07070917-line02-warmup-keepalive — 养号+验活合一 pass 纯判定函数合同（TDD Red）。
 *
 * 核心洞察（decision ba59f8b7）：小号掉线特征 = 切进去就没了/进不去，不是弹重登页。
 * 故验活用"切进去+读只有真登着才读得到的东西（我页昵称+粉丝数）"反证。
 *
 * DeviceAccountModel 尚未提供以下函数 — commit-2 需新增：
 *   - `fun parseFollowerCount(text: String?): Long?`（解析"4768粉丝"/"1.2万粉丝"，无法解析返回 null）
 *   - `data class LivenessVerdict(val alive: Boolean, val reason: String)`
 *   - `fun judgeAccountLiveness(readNickname: String?, targetNickname: String, followerCount: Long?, sawLoginPage: Boolean): LivenessVerdict`
 *   - `data class WarmupAccountResult(val nickname: String, val alive: Boolean, val followers: Long?, val reason: String)`
 *   - `data class WarmupReport(val total: Int, val aliveCount: Int, val offlineCount: Int, val results: List<WarmupAccountResult>)`
 *   - `fun aggregateWarmupReport(results: List<WarmupAccountResult>): WarmupReport`
 */
class DeviceAccountModelWarmupTest {

    // ── parseFollowerCount（我页"N粉丝"文本 → 数值）──────────────────────────────

    @Test
    fun `plain follower count parses`() {
        assertEquals(4768L, DeviceAccountModel.parseFollowerCount("4768粉丝"))
    }

    @Test
    fun `follower count with space parses`() {
        assertEquals(1196L, DeviceAccountModel.parseFollowerCount("1196 粉丝"))
    }

    @Test
    fun `wan suffix multiplies by ten thousand`() {
        assertEquals(12000L, DeviceAccountModel.parseFollowerCount("1.2万粉丝"))
    }

    @Test
    fun `integer wan parses`() {
        assertEquals(30000L, DeviceAccountModel.parseFollowerCount("3万粉丝"))
    }

    @Test
    fun `wan without 粉丝 suffix still parses`() {
        assertEquals(125000L, DeviceAccountModel.parseFollowerCount("12.5万"))
    }

    @Test
    fun `zero followers parses`() {
        assertEquals(0L, DeviceAccountModel.parseFollowerCount("0粉丝"))
    }

    @Test
    fun `text with no number returns null`() {
        assertNull(DeviceAccountModel.parseFollowerCount("粉丝"))
    }

    @Test
    fun `blank text returns null`() {
        assertNull(DeviceAccountModel.parseFollowerCount(""))
    }

    @Test
    fun `null text returns null`() {
        assertNull(DeviceAccountModel.parseFollowerCount(null))
    }

    // ── judgeAccountLiveness（综合判活，任一不满足=掉线）────────────────────────

    @Test
    fun `read nickname matches target with follower count and no login page is ALIVE`() {
        val v = DeviceAccountModel.judgeAccountLiveness(
            readNickname = "秦军餐饮",
            targetNickname = "秦军餐饮",
            followerCount = 4768L,
            sawLoginPage = false,
        )
        assertTrue(v.alive)
        assertEquals("alive", v.reason)
    }

    @Test
    fun `login page seen means OFFLINE regardless of other signals`() {
        val v = DeviceAccountModel.judgeAccountLiveness(
            readNickname = "秦军餐饮",
            targetNickname = "秦军餐饮",
            followerCount = 4768L,
            sawLoginPage = true,
        )
        assertFalse(v.alive)
        assertEquals("login_page", v.reason)
    }

    @Test
    fun `unreadable profile (null nickname) means OFFLINE`() {
        val v = DeviceAccountModel.judgeAccountLiveness(
            readNickname = null,
            targetNickname = "秦军餐饮",
            followerCount = null,
            sawLoginPage = false,
        )
        assertFalse(v.alive)
        assertEquals("profile_unreadable", v.reason)
    }

    @Test
    fun `no follower count means OFFLINE`() {
        val v = DeviceAccountModel.judgeAccountLiveness(
            readNickname = "秦军餐饮",
            targetNickname = "秦军餐饮",
            followerCount = null,
            sawLoginPage = false,
        )
        assertFalse(v.alive)
        assertEquals("no_follower_count", v.reason)
    }

    @Test
    fun `nickname reverted to a different account means OFFLINE`() {
        val v = DeviceAccountModel.judgeAccountLiveness(
            readNickname = "大湖成长之路（Ai+）",
            targetNickname = "秦军餐饮",
            followerCount = 1196L,
            sawLoginPage = false,
        )
        assertFalse(v.alive)
        assertEquals("account_reverted", v.reason)
    }

    // ── aggregateWarmupReport（整轮汇总）──────────────────────────────────────

    @Test
    fun `aggregate counts alive and offline`() {
        val results = listOf(
            DeviceAccountModel.WarmupAccountResult("秦军餐饮", alive = true, followers = 4768L, reason = "alive"),
            DeviceAccountModel.WarmupAccountResult("大湖成长之路（Ai+）", alive = true, followers = 1196L, reason = "alive"),
            DeviceAccountModel.WarmupAccountResult("某死号", alive = false, followers = null, reason = "login_page"),
        )
        val report = DeviceAccountModel.aggregateWarmupReport(results)
        assertEquals(3, report.total)
        assertEquals(2, report.aliveCount)
        assertEquals(1, report.offlineCount)
        assertEquals(results, report.results)
    }

    @Test
    fun `aggregate of empty results is all zero`() {
        val report = DeviceAccountModel.aggregateWarmupReport(emptyList())
        assertEquals(0, report.total)
        assertEquals(0, report.aliveCount)
        assertEquals(0, report.offlineCount)
    }
}
