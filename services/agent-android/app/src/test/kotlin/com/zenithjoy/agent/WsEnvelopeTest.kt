package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WsEnvelopeTest {
    @Test fun `解析信封透传 msgId`() {
        val e = WsEnvelope.parse("""{"v":1,"type":"cmd","msgId":"abc","payload":{"action":"tap"}}""")!!
        assertEquals("cmd", e.type)
        assertEquals("abc", e.msgId)
        assertEquals("tap", e.payload["action"])
    }

    @Test fun `缺 msgId 时为 null 不炸`() {
        val e = WsEnvelope.parse("""{"type":"heartbeat_ack","payload":{}}""")!!
        assertNull(e.msgId)
    }

    @Test fun `非法 JSON 返回 null`() {
        assertNull(WsEnvelope.parse("not json"))
    }

    @Test fun `缺 type 返回 null`() {
        assertNull(WsEnvelope.parse("""{"payload":{}}"""))
    }
}
