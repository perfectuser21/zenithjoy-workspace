package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

/**
 * Stage1 卡片分类 + abort 决策纯函数测试。
 *
 * 真机根因(2026-07-13 xian-rog 荣耀 MAA-AN00 / ANGYVB4311010223)：
 * `findVideoCards` 纯尺寸阈值(clickable 且 >400×400)选卡，**完全不区分卡类型**。
 * 搜"装修"(客户画像词，广告密度最高)结果页第一张就是广告卡
 * (text "西安120m'轻奢装修全包…" + content-desc "广告反馈" + "免费咨询" CTA)，
 * 被无脑选中 → 点开→点分享→抓不到 v.douyin.com 短链 → 计 failure；
 * `collectVideoCards` consecutiveFailures>=2 就 break → 连续 2 张广告 → 整个 Stage1 挂，
 * 后面真视频/图文也不采。间歇纯看广告排位，故被误称"抖动"。
 *
 * 修法(用户拍板 2026-07-13)：专门 tab 分栏采集(切「视频」tab 采视频、切「图文」tab 采图文，
 * 广告/直播天然不进专门 tab)；卡分类作二次防线——video/note 由当前 tab 决定，classify
 * 只需可靠**排除广告/直播**(不必精确区分 video/note)，跳过 AD/LIVE 不计 failure。
 *
 * 分类抽成纯 Kotlin `object CardClassifier`(无 Android 依赖，对齐既有 ClipboardCaptureGate/
 * ShareLinkExtractor)——既是采集稳定性守卫，也是图文/视频两路判定路由的共用地基。
 *
 * 测试样本全部取自真机 uiautomator dump 实测(Douyin 搜索"装修")。
 */
class DouyinCardClassifyTest {

    // 真机 dump 广告卡(搜"装修"结果页第一张)：text 含广告文案 + "免费咨询" CTA，desc 含"广告反馈"。
    private val adTexts = listOf(
        "西安120m'轻奢装修全包，设计/施工好效果，按期交付，品质高保障",
        "靓佳家•五星级整装", "免费咨询", "3.2万", "1733", "1.4万",
    )
    private val adDescs = listOf("广告反馈", "{靓佳家•五星级整装}的头像", "视频封面", "赞，未选中", "评论", "分享")

    // 真机 dump 视频卡(「视频」tab)：text 首项是时长标记 01:34。
    private val videoTexts = listOf(
        "01:34",
        "千呼万唤的一镜到底来啦～ 建面125套内100历时6个月花费10个装出的黑白灰极简小家 #装修 #一镜到底",
        "桃子的家🏠", "05.26", "5.9万",
    )
    private val videoDescs = listOf("未点赞，喜欢5.9万，按钮")

    // 真机 dump 图文卡(「图文」tab)：无时长标记。
    private val noteTexts = listOf(
        "爸妈装的工业风，惊艳朋友圈！145㎡只花28W，水泥墙+原木搭配绝",
        "LJC-Designer", "2025.10.04", "3344",
    )
    private val noteDescs = listOf("未点赞，喜欢3344，按钮")

    // ── classifyCard ────────────────────────────────────────────────────────

    @Test
    fun `广告卡(广告反馈desc + 免费咨询CTA)判为 AD — 真机装修第一张`() {
        assertEquals(
            CardClassifier.CardKind.AD,
            CardClassifier.classify(adTexts, adDescs),
        )
    }

    @Test
    fun `广告卡仅凭 content-desc 广告反馈 即可判 AD`() {
        assertEquals(
            CardClassifier.CardKind.AD,
            CardClassifier.classify(listOf("某商家推广文案"), listOf("广告反馈", "视频封面")),
        )
    }

    @Test
    fun `获取报价类 CTA 文案也判 AD`() {
        assertEquals(
            CardClassifier.CardKind.AD,
            CardClassifier.classify(listOf("整装套餐", "获取报价"), listOf("视频封面")),
        )
    }

    @Test
    fun `视频卡(含时长标记 + 无广告标记)判为 CONTENT`() {
        assertEquals(
            CardClassifier.CardKind.CONTENT,
            CardClassifier.classify(videoTexts, videoDescs),
        )
    }

    @Test
    fun `图文卡(无时长 + 无广告标记)判为 CONTENT`() {
        assertEquals(
            CardClassifier.CardKind.CONTENT,
            CardClassifier.classify(noteTexts, noteDescs),
        )
    }

    @Test
    fun `直播卡(含正在直播标)判为 LIVE`() {
        assertEquals(
            CardClassifier.CardKind.LIVE,
            CardClassifier.classify(listOf("正在直播", "主播小张", "1.2万人观看"), listOf("直播中")),
        )
    }

    // ── shouldSkipCard：AD/LIVE 跳过、不点开、不取链 ──────────────────────────

    @Test
    fun `AD 卡跳过不点开`() {
        assertTrue(CardClassifier.shouldSkip(CardClassifier.CardKind.AD))
    }

    @Test
    fun `LIVE 卡跳过不点开`() {
        assertTrue(CardClassifier.shouldSkip(CardClassifier.CardKind.LIVE))
    }

    @Test
    fun `CONTENT 卡不跳过(要采集)`() {
        assertFalse(CardClassifier.shouldSkip(CardClassifier.CardKind.CONTENT))
    }

    // ── shouldCountAsCollectFailure：abort 只对 CONTENT 取链真失败计数 ─────────
    // 真机根因：连续 2 张广告被计 failure → abort。修法：跳过的 AD/LIVE 绝不计 failure，
    // 只有目标内容卡(CONTENT)点开后取链真失败才计，避免广告把整轮采集拖死。

    @Test
    fun `AD 卡即便未取到链也不计 failure(根治广告 abort)`() {
        assertFalse(
            "广告卡是被主动跳过的，绝不能计入 consecutiveFailures，否则连续广告→abort→整轮挂",
            CardClassifier.shouldCountAsCollectFailure(
                CardClassifier.CardKind.AD, captureSucceeded = false,
            ),
        )
    }

    @Test
    fun `LIVE 卡不计 failure`() {
        assertFalse(
            CardClassifier.shouldCountAsCollectFailure(
                CardClassifier.CardKind.LIVE, captureSucceeded = false,
            ),
        )
    }

    @Test
    fun `CONTENT 卡取链失败才计 failure`() {
        assertTrue(
            CardClassifier.shouldCountAsCollectFailure(
                CardClassifier.CardKind.CONTENT, captureSucceeded = false,
            ),
        )
    }

    @Test
    fun `CONTENT 卡取链成功不计 failure`() {
        assertFalse(
            CardClassifier.shouldCountAsCollectFailure(
                CardClassifier.CardKind.CONTENT, captureSucceeded = true,
            ),
        )
    }
}
