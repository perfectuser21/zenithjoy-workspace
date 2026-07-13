package com.zenithjoy.agent.collect

/**
 * 抖音搜索结果卡片分类器（纯 Kotlin，无 Android 依赖）。
 *
 * 真机根因(2026-07-13 xian-rog 荣耀 MAA-AN00 / ANGYVB4311010223)：Stage1 取卡循环
 * `findVideoCards` 纯尺寸阈值(clickable 且 bounds>400×400)选卡，**完全不区分卡类型**。
 * 搜"装修"(客户画像词，广告密度最高)结果页第一张就是广告卡(content-desc "广告反馈" +
 * "免费咨询" CTA)，被无脑选中 → 点开→点分享→抓不到 v.douyin.com 短链 → 计 failure；
 * consecutiveFailures>=2 就 abort → 连续 2 张广告 → 整个 Stage1 挂。间歇纯看广告排位。
 *
 * 修法(用户拍板)：专门 tab 分栏采集(切「视频」/「图文」tab，广告/直播天然不进专门 tab)，
 * 本分类器作**二次防线**——video/note 由当前 tab 决定，classify 只需可靠**排除广告/直播**，
 * 不必精确区分 video vs note，故判据鲁棒(白名单 CONTENT 兜底)。
 *
 * 对齐既有纯 object [ClipboardCaptureGate] / [ShareLinkExtractor]；也是图文/视频两路
 * 判定路由的共用地基。分类依据全部取自真机 uiautomator dump 实测。
 */
object CardClassifier {

    enum class CardKind { AD, LIVE, CONTENT }

    // 广告铁证：content-desc "广告反馈"(真机每张广告卡必带) + 明确转化 CTA 文案。
    // 刻意不含裸"广告"二字——视频/图文标题可能出现(如"不是广告"/"广告法")，会误伤内容卡。
    private val AD_MARKERS = listOf(
        "广告反馈", "免费咨询", "获取报价", "立即咨询", "立即预约", "领取报价", "预约设计",
    )

    // 直播标记(真机未 dump 到直播卡，先按抖音公开 UI 常识兜底，待真机撞到直播卡再校准)。
    private val LIVE_MARKERS = listOf("直播中", "正在直播", "去看直播", "直播间")

    /**
     * 分类一张卡：喂入其子树 flatten 出的所有 text + content-desc。
     * 优先级 AD > LIVE > CONTENT——广告标记最强(要坚决排除)，其余内容卡一律 CONTENT。
     */
    fun classify(texts: List<String>, descs: List<String>): CardKind {
        val blob = texts + descs
        if (blob.any { s -> AD_MARKERS.any { s.contains(it) } }) return CardKind.AD
        if (blob.any { s -> LIVE_MARKERS.any { s.contains(it) } }) return CardKind.LIVE
        return CardKind.CONTENT
    }

    /** AD/LIVE 直接跳过：不点开、不点分享、不取链。 */
    fun shouldSkip(kind: CardKind): Boolean = kind == CardKind.AD || kind == CardKind.LIVE

    /**
     * abort 计数判据(根治广告 abort)：只有目标内容卡(CONTENT)点开后取链**真失败**才计入
     * consecutiveFailures。被主动跳过的 AD/LIVE 绝不计——否则连续广告 → abort → 整轮挂。
     */
    fun shouldCountAsCollectFailure(kind: CardKind, captureSucceeded: Boolean): Boolean =
        kind == CardKind.CONTENT && !captureSucceeded
}
