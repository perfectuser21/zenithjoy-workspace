package com.zenithjoy.agent.collect

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipboardCaptureGateTest {

    // TC-G01: 别名前缀匹配（text 通道）
    @Test fun `matches share link label via text`() {
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel("分享链接", null))
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel("复制链接给好友", null))
    }

    // TC-G02: 别名前缀匹配（contentDesc 通道）
    @Test fun `matches share link label via content desc`() {
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel(null, "口令"))
    }

    // TC-G03: 不命中别名
    @Test fun `does not match unrelated label`() {
        assertFalse(ClipboardCaptureGate.matchShareLinkLabel("保存本地", "举报"))
        assertFalse(ClipboardCaptureGate.matchShareLinkLabel(null, null))
    }

    // TC-G04: 面板锚点——含取消即判面板
    @Test fun `is share panel when cancel anchor present`() {
        assertTrue(ClipboardCaptureGate.isSharePanel(listOf("转发到日常", "取消")))
    }

    // TC-G05: 面板锚点——≥2 别名命中
    @Test fun `is share panel when two labels hit`() {
        assertTrue(ClipboardCaptureGate.isSharePanel(listOf("复制链接", "分享链接", "举报")))
    }

    // TC-G06: 详情页节点集不判为面板
    @Test fun `detail page nodes are not share panel`() {
        assertFalse(ClipboardCaptureGate.isSharePanel(listOf("关注", "评论", "点赞", "分享")))
    }

    // TC-G07: 新鲜度——clip 早于点击则拒
    @Test fun `stale clip rejected`() {
        assertFalse(ClipboardCaptureGate.isFresh(clipTimestampMs = 1000L, clickTimestampMs = 2000L))
        assertTrue(ClipboardCaptureGate.isFresh(clipTimestampMs = 3000L, clickTimestampMs = 2000L))
    }

    // TC-G08: 去重
    @Test fun `duplicate url rejected`() {
        val seen = setOf("https://v.douyin.com/AbC123/")
        assertTrue(ClipboardCaptureGate.isDuplicate("https://v.douyin.com/AbC123/", seen))
        assertFalse(ClipboardCaptureGate.isDuplicate("https://v.douyin.com/xYz789/", seen))
    }

    // TC-G09: token 校验——不符拒，相符收，legacy 豁免
    @Test fun `delivery token validated with legacy exemption`() {
        assertTrue(ClipboardCaptureGate.acceptDelivery(deliveryToken = 5L, expectedToken = 5L))
        assertFalse(ClipboardCaptureGate.acceptDelivery(deliveryToken = 4L, expectedToken = 5L))
        assertTrue(ClipboardCaptureGate.acceptDelivery(
            deliveryToken = ClipboardCaptureGate.LEGACY_ACTION_SEND_TOKEN, expectedToken = 5L))
    }
}
