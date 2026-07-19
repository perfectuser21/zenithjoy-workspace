package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * CardTitleExtractor 纯函数测试——从卡片节点文本列表里挑 best-effort 标题。
 *
 * 真机根因 2026-07-19：VideoCardInfo.title 字段存在但从未被赋值，
 * acquisition_collect_videos.title 列因此永远是 null，"转写文案+title判定"
 * (2026-07-17决策，判定点1d078987) 的 title 信号从 Stage1 采集起就从未捕获过。
 *
 * 样本取自 DouyinCardClassifyTest 的真机 uiautomator dump 实测文本。
 */
class CardTitleExtractorTest {

    @Test
    fun `真机视频卡样本中最长文本是标题`() {
        val videoTexts = listOf(
            "01:34",
            "千呼万唤的一镜到底来啦～ 建面125套内100历时6个月花费10个装出的黑白灰极简小家 #装修 #一镜到底",
            "桃子的家🏠", "05.26", "5.9万",
        )
        assertEquals(
            "千呼万唤的一镜到底来啦～ 建面125套内100历时6个月花费10个装出的黑白灰极简小家 #装修 #一镜到底",
            CardTitleExtractor.pickTitle(videoTexts),
        )
    }

    @Test
    fun `真机图文卡样本中最长文本是标题`() {
        val noteTexts = listOf(
            "爸妈装的工业风，惊艳朋友圈！145㎡只花28W，水泥墙+原木搭配绝",
            "LJC-Designer", "2025.10.04", "3344",
        )
        assertEquals(
            "爸妈装的工业风，惊艳朋友圈！145㎡只花28W，水泥墙+原木搭配绝",
            CardTitleExtractor.pickTitle(noteTexts),
        )
    }

    @Test
    fun `空文本列表返回null`() {
        assertNull(CardTitleExtractor.pickTitle(emptyList()))
    }
}
