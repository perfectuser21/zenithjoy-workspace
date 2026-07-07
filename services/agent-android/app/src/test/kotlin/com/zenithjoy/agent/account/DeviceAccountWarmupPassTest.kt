package com.zenithjoy.agent.account

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sprint 07070917-line02-warmup-keepalive — 养号+验活合一 pass 编排合同（TDD Red）。
 *
 * DeviceAccountWarmupPass 尚未实现 — commit-2 需新增（services/.../account/DeviceAccountWarmupPass.kt）：
 *   - `data class MyProfile(val nickname: String, val followerText: String?)`
 *   - `interface DouyinUiaOps { suspend fun launchAndSettle(): Boolean; suspend fun openSwitchAccountPanel(): Boolean;
 *      suspend fun readAccountNicknames(): List<String>?; suspend fun switchToAccountByNickname(nickname: String): Boolean;
 *      suspend fun browseFeed(videoCount: Int); suspend fun readMyProfile(): MyProfile?; suspend fun sawLoginPage(): Boolean;
 *      suspend fun switchToOperator(nickname: String): Boolean; fun forceCloseToHome() }`
 *   - `class DeviceAccountWarmupPass(ops: DouyinUiaOps, videoCountPerAccount: Int = 2) { suspend fun run(operatorNickname: String?): DeviceAccountModel.WarmupReport }`
 *
 * 编排纪律：逐号切进→刷视频→读我页判活；单号失败/异常隔离（记 offline 继续下一号，不中断整轮）；
 * 收尾 operatorNickname 非空才切操作号（空/空白跳过，不崩）。
 */
class DeviceAccountWarmupPassTest {

    /** 可配置的 fake UIA ops，记录调用序列供断言。 */
    private class FakeOps(
        val nicknames: List<String>? = listOf("秦军餐饮", "大湖成长之路（Ai+）"),
        val settleOk: Boolean = true,
        val panelOk: Boolean = true,
        val switchOkFor: (String) -> Boolean = { true },
        val profileFor: (String) -> MyProfile? = { MyProfile(it, "1000粉丝") },
        val loginPageFor: (String) -> Boolean = { false },
        val throwSwitchFor: (String) -> Boolean = { false },
    ) : DouyinUiaOps {
        var currentNick: String = ""
        val browseCalls = mutableListOf<Pair<String, Int>>()
        val switchedTo = mutableListOf<String>()
        var operatorSwitched: String? = null
        var forceClosed = false

        override suspend fun launchAndSettle(): Boolean = settleOk
        override suspend fun openSwitchAccountPanel(): Boolean = panelOk
        override suspend fun readAccountNicknames(): List<String>? = nicknames
        override suspend fun switchToAccountByNickname(nickname: String): Boolean {
            if (throwSwitchFor(nickname)) throw IllegalStateException("uia dead on $nickname")
            currentNick = nickname
            switchedTo.add(nickname)
            return switchOkFor(nickname)
        }
        override suspend fun browseFeed(videoCount: Int) { browseCalls.add(currentNick to videoCount) }
        override suspend fun readMyProfile(): MyProfile? = profileFor(currentNick)
        override suspend fun sawLoginPage(): Boolean = loginPageFor(currentNick)
        override suspend fun switchToOperator(nickname: String): Boolean { operatorSwitched = nickname; return true }
        override fun forceCloseToHome() { forceClosed = true }
    }

    @Test
    fun `two live accounts both judged alive`() = runBlocking {
        val ops = FakeOps(
            profileFor = { nick -> if (nick == "秦军餐饮") MyProfile("秦军餐饮", "4768粉丝") else MyProfile("大湖成长之路（Ai+）", "1196粉丝") },
        )
        val report = DeviceAccountWarmupPass(ops).run(operatorNickname = null)
        assertEquals(2, report.total)
        assertEquals(2, report.aliveCount)
        assertEquals(0, report.offlineCount)
        assertEquals(listOf("秦军餐饮", "大湖成长之路（Ai+）"), ops.switchedTo)
        assertEquals(4768L, report.results[0].followers)
    }

    @Test
    fun `each account browses configured number of videos`() = runBlocking {
        val ops = FakeOps()
        DeviceAccountWarmupPass(ops, videoCountPerAccount = 3).run(operatorNickname = null)
        assertEquals(2, ops.browseCalls.size)
        assertTrue(ops.browseCalls.all { it.second == 3 })
    }

    @Test
    fun `account that reverts to a different nickname is offline`() = runBlocking {
        val ops = FakeOps(
            profileFor = { nick -> if (nick == "死号") MyProfile("秦军餐饮", "4768粉丝") else MyProfile(nick, "1000粉丝") },
            nicknames = listOf("死号", "活号"),
        )
        val report = DeviceAccountWarmupPass(ops).run(null)
        val dead = report.results.first { it.nickname == "死号" }
        assertFalse(dead.alive)
        assertEquals("account_reverted", dead.reason)
    }

    @Test
    fun `account hitting login page is offline`() = runBlocking {
        val ops = FakeOps(loginPageFor = { it == "死号" }, nicknames = listOf("死号", "活号"))
        val report = DeviceAccountWarmupPass(ops).run(null)
        assertFalse(report.results.first { it.nickname == "死号" }.alive)
        assertEquals("login_page", report.results.first { it.nickname == "死号" }.reason)
        // 活号照常判活，未被前一个死号中断
        assertTrue(report.results.first { it.nickname == "活号" }.alive)
    }

    @Test
    fun `switch failure on one account is isolated, next account still processed`() = runBlocking {
        val ops = FakeOps(switchOkFor = { it != "切不进的号" }, nicknames = listOf("切不进的号", "活号"))
        val report = DeviceAccountWarmupPass(ops).run(null)
        val failed = report.results.first { it.nickname == "切不进的号" }
        assertFalse(failed.alive)
        assertEquals("switch_failed", failed.reason)
        assertTrue(report.results.first { it.nickname == "活号" }.alive)
    }

    @Test
    fun `exception mid-account is caught and isolated`() = runBlocking {
        val ops = FakeOps(throwSwitchFor = { it == "崩号" }, nicknames = listOf("崩号", "活号"))
        val report = DeviceAccountWarmupPass(ops).run(null)
        assertFalse(report.results.first { it.nickname == "崩号" }.alive)
        assertTrue(report.results.first { it.nickname == "活号" }.alive)
    }

    @Test
    fun `operator nickname provided switches to operator at the end`() = runBlocking {
        val ops = FakeOps()
        DeviceAccountWarmupPass(ops).run(operatorNickname = "秦军餐饮")
        assertEquals("秦军餐饮", ops.operatorSwitched)
    }

    @Test
    fun `blank operator nickname skips final switch without crashing`() = runBlocking {
        val ops = FakeOps()
        val report = DeviceAccountWarmupPass(ops).run(operatorNickname = "")
        assertEquals(null, ops.operatorSwitched)
        assertEquals(2, report.total)
    }

    @Test
    fun `panel open failure yields empty report`() = runBlocking {
        val ops = FakeOps(panelOk = false)
        val report = DeviceAccountWarmupPass(ops).run(null)
        assertEquals(0, report.total)
    }

    @Test
    fun `nickname read failure (null) yields empty report`() = runBlocking {
        val ops = FakeOps(nicknames = null)
        val report = DeviceAccountWarmupPass(ops).run(null)
        assertEquals(0, report.total)
    }
}
