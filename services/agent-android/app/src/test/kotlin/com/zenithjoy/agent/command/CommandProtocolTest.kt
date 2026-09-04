package com.zenithjoy.agent.command

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandProtocolTest {
    private val SW = 1080
    private val SH = 2400

    @Test fun `tap 合法坐标解析成功`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to 540.0, "y" to 1200.0), SW, SH)
        r as ParseOutcome.Ok
        assertEquals(CmdAction.TAP, r.request.action)
        assertEquals(540, r.request.args["x"])
    }

    @Test fun `tap 负坐标拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to -5.0, "y" to 10.0), SW, SH)
        r as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_COORD_OUT_OF_BOUNDS, r.code)
    }

    @Test fun `tap 超出屏幕拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to 1080.0, "y" to 10.0), SW, SH)
        assertTrue(r is ParseOutcome.Err)
    }

    @Test fun `swipe durationMs 缺省300并夹逼到50-10000`() {
        val ok = CommandProtocol.parse("m1", mapOf("action" to "swipe", "x1" to 1.0, "y1" to 1.0, "x2" to 2.0, "y2" to 2.0), SW, SH) as ParseOutcome.Ok
        assertEquals(300L, ok.request.args["durationMs"])
        val clamped = CommandProtocol.parse("m1", mapOf("action" to "swipe", "x1" to 1.0, "y1" to 1.0, "x2" to 2.0, "y2" to 2.0, "durationMs" to 999999.0), SW, SH) as ParseOutcome.Ok
        assertEquals(10000L, clamped.request.args["durationMs"])
    }

    @Test fun `未知 action 报 UNKNOWN_ACTION`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "fly"), SW, SH) as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_UNKNOWN_ACTION, r.code)
    }

    @Test fun `缺 msgId 报 BAD_REQUEST`() {
        val r = CommandProtocol.parse(null, mapOf("action" to "tap", "x" to 1.0, "y" to 1.0), SW, SH) as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_BAD_REQUEST, r.code)
    }

    @Test fun `key 只认 back home`() {
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "key", "name" to "back"), SW, SH) is ParseOutcome.Ok)
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "key", "name" to "menu"), SW, SH) is ParseOutcome.Err)
    }

    @Test fun `type 需要 text 字段`() {
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "type"), SW, SH) is ParseOutcome.Err)
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "type", "text" to "hi"), SW, SH) is ParseOutcome.Ok)
    }

    @Test fun `buildResult 带 inReplyTo ok errorCode foregroundPkg data`() {
        val m = CommandProtocol.buildResult("m1", CmdOutcome(false, CommandProtocol.ERR_QUEUE_FULL), "com.x")
        assertEquals("m1", m["inReplyTo"]); assertEquals(false, m["ok"])
        assertEquals(CommandProtocol.ERR_QUEUE_FULL, m["errorCode"]); assertEquals("com.x", m["foregroundPkg"])
    }
}
