package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 该取哪些窗口的无障碍树——纯决策，因为取树本身极贵。
 *
 * 真机实测（2026-08-18，小粉 ANY-AN00）：设备同时有 **54 个窗口**，其中只有 5 个有 surface，
 * 且 `mCurrentFocus=null`（所以 rootInActiveWindow 恒为 null）。前台闸初版对 take(6) 个窗口
 * 逐个取 root，每次跨进程拉一棵树约 1.7 秒 → 一轮 10 秒（设计值 500ms）。
 *
 * 结论：不能按「前 N 个」截断，必须按「可能承载可点弹窗」筛选，把取树次数压到个位数以内。
 */
class WindowSelectionTest {

    private fun w(type: Int, active: Boolean = false, focused: Boolean = false, area: Long = 100_000) =
        NodeAwait.WindowSpec(type = type, isActive = active, isFocused = focused, areaPx = area)

    private val APP = NodeAwait.WINDOW_TYPE_APPLICATION
    private val SYS = NodeAwait.WINDOW_TYPE_SYSTEM
    private val IME = NodeAwait.WINDOW_TYPE_INPUT_METHOD
    private val A11Y = NodeAwait.WINDOW_TYPE_ACCESSIBILITY_OVERLAY

    @Test
    fun `focused window ranks first`() {
        val specs = listOf(w(APP), w(SYS, focused = true), w(APP))
        assertEquals(listOf(1, 0, 2), NodeAwait.selectWindowIndices(specs, max = 3))
    }

    @Test
    fun `active window ranks above plain ones`() {
        val specs = listOf(w(APP), w(APP, active = true))
        assertEquals(listOf(1, 0), NodeAwait.selectWindowIndices(specs, max = 2))
    }

    @Test
    fun `input method and accessibility overlays are excluded`() {
        // 输入法与自家无障碍浮层里不会有厂商插屏，取它们的树纯属浪费
        val specs = listOf(w(IME, focused = true), w(A11Y, active = true), w(APP))
        assertEquals(listOf(2), NodeAwait.selectWindowIndices(specs, max = 5))
    }

    @Test
    fun `caps at max to bound the cost`() {
        val specs = (1..54).map { w(APP) }
        assertEquals(3, NodeAwait.selectWindowIndices(specs, max = 3).size)
    }

    @Test
    fun `empty input yields empty selection`() {
        assertEquals(emptyList<Int>(), NodeAwait.selectWindowIndices(emptyList(), max = 3))
    }

    @Test
    fun `smaller window wins when rank ties - dialogs are small`() {
        // 同为普通 APPLICATION 窗口时，小窗口更可能是对话框，优先看它
        val specs = listOf(w(APP, area = 2_000_000), w(APP, area = 50_000))
        assertEquals(listOf(1, 0), NodeAwait.selectWindowIndices(specs, max = 2))
    }
}
