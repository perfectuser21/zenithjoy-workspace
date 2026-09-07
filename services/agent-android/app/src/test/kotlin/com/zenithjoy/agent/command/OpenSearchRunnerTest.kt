package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenSearchRunnerTest {
    private val WL = setOf("com.ss.android.ugc.aweme")

    @Test fun `前台不在白名单拒绝`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.android.settings" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("装修").errorCode)
    }

    @Test fun `搜索入口找不到回 SEARCH_ENTRY_NOT_FOUND`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { null },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_SEARCH_ENTRY_NOT_FOUND, r.run("装修").errorCode)
    }

    @Test fun `输入框找不到回 NO_FOCUSED_EDITABLE`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { null },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_NO_FOCUSED_EDITABLE, r.run("装修").errorCode)
    }

    @Test fun `SET_TEXT 失败回 SET_TEXT_FAILED`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { false },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_SET_TEXT_FAILED, r.run("装修").errorCode)
    }

    @Test fun `提交失败回 SEARCH_SUBMIT_FAILED`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { false },
        )
        assertEquals(CommandProtocol.ERR_SEARCH_SUBMIT_FAILED, r.run("装修").errorCode)
    }

    @Test fun `成功路径`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertTrue(r.run("装修").ok)
    }
}
