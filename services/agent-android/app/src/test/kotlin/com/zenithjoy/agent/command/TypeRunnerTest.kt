package com.zenithjoy.agent.command

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TypeRunnerTest {
    private val WL = setOf("com.ss.android.ugc.aweme")

    @Test fun `前台不在白名单拒绝`() {
        val r = TypeRunner({ "com.android.settings" }, WL, { true })
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("hi").errorCode)
    }

    @Test fun `前台包名读不到拒绝`() {
        val r = TypeRunner({ null }, WL, { true })
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("hi").errorCode)
    }

    @Test fun `无焦点可编辑节点回 NO_FOCUSED_EDITABLE`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { null })
        assertEquals(CommandProtocol.ERR_NO_FOCUSED_EDITABLE, r.run("hi").errorCode)
    }

    @Test fun `SET_TEXT 返回 false 回 SET_TEXT_FAILED`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { false })
        assertEquals(CommandProtocol.ERR_SET_TEXT_FAILED, r.run("hi").errorCode)
    }

    @Test fun `成功路径`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { true })
        assertTrue(r.run("hi").ok)
    }
}
