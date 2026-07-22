package com.zenithjoy.agent.collect

/**
 * 采集失败原因分类器（2026-07-22 Path2 安卓信号上报 sprint）。
 *
 * DouyinCollectService 目前产生 11+ 个具体的自由字符串错误码（NO_SEARCH_INPUT/
 * SEARCH_TIMEOUT 等），中台/客户看到的是一堆技术黑话。这里归类成 5 类 + UNKNOWN
 * 人话分类，客户能直接看懂"是关键词问题还是网络问题还是号有问题"。
 *
 * 分类原则（决策点 e38c097b，用户拍板）：Android 端做确定性分类，分不清的一律归
 * UNKNOWN，不臆造分类——宁可漏分类不可误分类，跟 comment-grading.ts 的"宁可漏判
 * 不可误判"是同一哲学。
 */
object CollectFailureClassifier {

    private val KEYWORD_NO_RESULT_CODES = setOf(
        "NO_SEARCH_INPUT", "NO_COMMENTS_WINDOW", "COMMENT_BUTTON_NOT_FOUND",
    )
    private val PLATFORM_LIMITED_CODES = setOf(
        "NO_WINDOW", "NO_WINDOW_BEFORE_SUBMIT", "SUBMIT_SEARCH_TIMEOUT", "SEARCH_TIMEOUT",
    )
    private val NETWORK_ERROR_CODES = setOf(
        "VIDEO_URL_OPEN_TIMEOUT", "EXTRACTION_TIMEOUT", "NETWORK_ERROR",
    )
    private val ACCOUNT_ABNORMAL_CODES = setOf(
        "LAUNCH_FAILED", "DEEPLINK_LAUNCH_FAILED",
    )

    fun classify(rawErrorCode: String): String {
        if (rawErrorCode.startsWith("HTTP_")) return "NETWORK_ERROR"
        return when (rawErrorCode) {
            in KEYWORD_NO_RESULT_CODES -> "KEYWORD_NO_RESULT"
            in PLATFORM_LIMITED_CODES -> "PLATFORM_LIMITED"
            in NETWORK_ERROR_CODES -> "NETWORK_ERROR"
            in ACCOUNT_ABNORMAL_CODES -> "ACCOUNT_ABNORMAL"
            else -> "UNKNOWN"
        }
    }
}
