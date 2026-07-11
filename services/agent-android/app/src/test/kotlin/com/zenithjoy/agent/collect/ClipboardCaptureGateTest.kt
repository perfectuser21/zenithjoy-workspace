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

    // ── 准入双闸（新鲜度 + 去重）：接线后 captureShareUrlForCard 第 9 步的真实判定 ──

    // TC-G10: 复现串号漏网——任务开始前剪贴板已有一条合法但无关的残留短链 L_old，
    // 其写入时刻(clipTs)早于本卡点"分享链接"的时刻(clickTs)，必须被时间戳闸拒，
    // 绝不上报（宁可漏采不可造假）。isFresh 未接进 admitShareUrl 时此断言会失败。
    @Test fun `admit rejects stale residual clip (string mixup guard)`() {
        assertFalse(ClipboardCaptureGate.admitShareUrl(
            url = "https://v.douyin.com/OLD123/",
            clipTimestampMs = 1000L,
            clickTimestampMs = 2000L,
            seen = emptySet()))
    }

    // TC-G11: 点击后新写入的短链（clipTs > clickTs）放行
    @Test fun `admit accepts fresh clip`() {
        assertTrue(ClipboardCaptureGate.admitShareUrl(
            url = "https://v.douyin.com/NEW456/",
            clipTimestampMs = 3000L,
            clickTimestampMs = 2000L,
            seen = emptySet()))
    }

    // TC-G12: 新鲜但重复仍拒（去重闸继续生效）
    @Test fun `admit rejects fresh but duplicate`() {
        assertFalse(ClipboardCaptureGate.admitShareUrl(
            url = "https://v.douyin.com/DUP/",
            clipTimestampMs = 3000L,
            clickTimestampMs = 2000L,
            seen = setOf("https://v.douyin.com/DUP/")))
    }

    // TC-G13: legacy 投递（ACTION_SEND 旧路径，无真实 clip 时间戳）豁免时间戳闸，不被误杀
    @Test fun `admit exempts legacy delivery from freshness gate`() {
        assertTrue(ClipboardCaptureGate.admitShareUrl(
            url = "https://v.douyin.com/LEGACY/",
            clipTimestampMs = ClipboardCaptureGate.LEGACY_CLIP_TIMESTAMP_MS,
            clickTimestampMs = 9_999_999L,
            seen = emptySet()))
    }

    // TC-G14: legacy sentinel 直接判新鲜
    @Test fun `legacy clip timestamp is always fresh`() {
        assertTrue(ClipboardCaptureGate.isFresh(
            ClipboardCaptureGate.LEGACY_CLIP_TIMESTAMP_MS, 9_999_999L))
    }

    // TC-G15: 读不到 clip 时间戳（0L 保守值）视为不新鲜，拒
    @Test fun `admit rejects when clip timestamp unavailable`() {
        assertFalse(ClipboardCaptureGate.admitShareUrl(
            url = "https://v.douyin.com/NOTS/",
            clipTimestampMs = 0L,
            clickTimestampMs = 2000L,
            seen = emptySet()))
    }
}
