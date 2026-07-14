package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 真机根因(2026-07-14 xian-rog)：抖音详情页是竖向翻页器，无障碍树里同时含
 * 当前视频 + 相邻视频（屏幕外）的「分享」按钮。BFS 取首个匹配会命中屏幕外那个
 * （bounds 为空矩形 bottom<top，如 dump 里 b=197x-193），tapNodeCenter 因
 * bounds.isEmpty 静默跳过不点 → 分享面板不弹 → 取链失败。
 * 修：选按钮时只取【在屏可见】的那个。本测试守住该纯选择逻辑。
 */
class ShareButtonVisibilityTest {

    private val SW = 1200
    private val SH = 2664

    // 在屏可见（card#0 成功那次）：唯一在屏节点排首 → 选 0
    @Test fun `picks on-screen button when it is first`() {
        val boxes = listOf(
            ClipboardCaptureGate.NodeBox(900, 1900, 1097, 2119), // 在屏 分享140
            ClipboardCaptureGate.NodeBox(900, -2286, 1097, -2086), // 屏幕外(上) 分享7.9万
        )
        assertEquals(0, ClipboardCaptureGate.pickVisibleShareButtonIndex(boxes, SW, SH))
    }

    // 真失败复现(card#1/#2)：首个是空矩形(bottom<top)屏幕外，第二个才在屏 → 选 1
    @Test fun `skips inverted-bounds off-screen node and picks visible one`() {
        val boxes = listOf(
            ClipboardCaptureGate.NodeBox(900, 100, 1097, -93), // b=197x-193 空矩形(bottom<top)
            ClipboardCaptureGate.NodeBox(900, 1900, 1097, 2125), // 在屏 分享7.9万
        )
        assertEquals(1, ClipboardCaptureGate.pickVisibleShareButtonIndex(boxes, SW, SH))
    }

    // 屏幕外(下，top 超屏高)排首，在屏排后 → 选在屏
    @Test fun `skips below-screen node and picks visible one`() {
        val boxes = listOf(
            ClipboardCaptureGate.NodeBox(900, 3000, 1097, 3200), // top>屏高，屏幕外(下)
            ClipboardCaptureGate.NodeBox(900, 1900, 1097, 2119), // 在屏
        )
        assertEquals(1, ClipboardCaptureGate.pickVisibleShareButtonIndex(boxes, SW, SH))
    }

    // 全部屏幕外 → -1（不点，避免静默空点）
    @Test fun `returns -1 when no node is on-screen`() {
        val boxes = listOf(
            ClipboardCaptureGate.NodeBox(900, 100, 1097, -93),
            ClipboardCaptureGate.NodeBox(900, -2286, 1097, -2086),
        )
        assertEquals(-1, ClipboardCaptureGate.pickVisibleShareButtonIndex(boxes, SW, SH))
    }

    // 空候选 → -1
    @Test fun `returns -1 for empty candidates`() {
        assertEquals(-1, ClipboardCaptureGate.pickVisibleShareButtonIndex(emptyList(), SW, SH))
    }

    // 多个在屏：取首个在屏（稳定，避免抖动）
    @Test fun `picks first on-screen when multiple visible`() {
        val boxes = listOf(
            ClipboardCaptureGate.NodeBox(900, -2286, 1097, -2086), // 屏幕外
            ClipboardCaptureGate.NodeBox(900, 1900, 1097, 2119), // 在屏(首个可见)
            ClipboardCaptureGate.NodeBox(900, 500, 1097, 700), // 也在屏
        )
        assertEquals(1, ClipboardCaptureGate.pickVisibleShareButtonIndex(boxes, SW, SH))
    }
}
