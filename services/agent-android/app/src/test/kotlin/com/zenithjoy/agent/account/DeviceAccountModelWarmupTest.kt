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

    // ── 我页几何定位（真机 Honor100/抖音39.4.0 dump 实测 bounds，标签分离结构）─────
    // 我页粉丝数不是"4768粉丝"合并文本，而是 数值 TextView + "粉丝"label 上下两个节点；
    // 昵称在"抖音号：xxx"锚点正上方。混淆 resource-id(thp/5pm)随版本变，必须靠几何+稳定中文锚点。

    private fun profileNodes() = listOf(
        DeviceAccountModel.TextNode("秦军餐饮", 445, 350, 733, 447),
        DeviceAccountModel.TextNode("抖音号：perfect21xx", 445, 455, 820, 507),
        DeviceAccountModel.TextNode("创建 AI 形象", 465, 543, 701, 600),
        DeviceAccountModel.TextNode("5.3万", 52, 756, 193, 833),
        DeviceAccountModel.TextNode("获赞", 77, 833, 167, 895),
        DeviceAccountModel.TextNode("12", 297, 756, 355, 833),
        DeviceAccountModel.TextNode("互关", 281, 833, 371, 895),
        DeviceAccountModel.TextNode("167", 459, 756, 548, 833),
        DeviceAccountModel.TextNode("关注", 459, 833, 549, 895),
        DeviceAccountModel.TextNode("4768", 637, 756, 768, 833),
        DeviceAccountModel.TextNode("粉丝", 657, 833, 747, 895),
    )

    @Test
    fun `follower value is the node directly above the 粉丝 label`() {
        assertEquals("4768", DeviceAccountModel.findValueAboveLabel(profileNodes(), "粉丝"))
    }

    @Test
    fun `like count value sits above 获赞 label`() {
        assertEquals("5.3万", DeviceAccountModel.findValueAboveLabel(profileNodes(), "获赞"))
    }

    @Test
    fun `following count value sits above 关注 label, not confused with adjacent columns`() {
        assertEquals("167", DeviceAccountModel.findValueAboveLabel(profileNodes(), "关注"))
    }

    @Test
    fun `missing label yields null`() {
        assertNull(DeviceAccountModel.findValueAboveLabel(profileNodes(), "不存在"))
    }

    @Test
    fun `nickname is the node directly above the 抖音号 anchor`() {
        assertEquals("秦军餐饮", DeviceAccountModel.findTextAboveAnchor(profileNodes(), "抖音号"))
    }

    @Test
    fun `no 抖音号 anchor (e g logged out page) yields null nickname`() {
        val loginPage = listOf(
            DeviceAccountModel.TextNode("手机号登录", 100, 400, 500, 460),
            DeviceAccountModel.TextNode("获取验证码", 100, 600, 500, 660),
        )
        assertNull(DeviceAccountModel.findTextAboveAnchor(loginPage, "抖音号"))
    }

    @Test
    fun `follower text parsed from profile geometry yields numeric count`() {
        val followerText = DeviceAccountModel.findValueAboveLabel(profileNodes(), "粉丝")
        assertEquals(4768L, DeviceAccountModel.parseFollowerCount(followerText))
    }
}
