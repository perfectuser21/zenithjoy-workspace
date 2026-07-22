package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Test

class CollectFailureClassifierTest {

    @Test
    fun `搜索超时和面板打不开归为平台限制`() {
        assertEquals("PLATFORM_LIMITED", CollectFailureClassifier.classify("NO_WINDOW"))
        assertEquals("PLATFORM_LIMITED", CollectFailureClassifier.classify("NO_WINDOW_BEFORE_SUBMIT"))
        assertEquals("PLATFORM_LIMITED", CollectFailureClassifier.classify("SUBMIT_SEARCH_TIMEOUT"))
        assertEquals("PLATFORM_LIMITED", CollectFailureClassifier.classify("SEARCH_TIMEOUT"))
    }

    @Test
    fun `搜不到输入框和抓不到评论归为关键词无结果`() {
        assertEquals("KEYWORD_NO_RESULT", CollectFailureClassifier.classify("NO_SEARCH_INPUT"))
        assertEquals("KEYWORD_NO_RESULT", CollectFailureClassifier.classify("NO_COMMENTS_WINDOW"))
        assertEquals("KEYWORD_NO_RESULT", CollectFailureClassifier.classify("COMMENT_BUTTON_NOT_FOUND"))
    }

    @Test
    fun `跳转超时归为网络异常`() {
        assertEquals("NETWORK_ERROR", CollectFailureClassifier.classify("VIDEO_URL_OPEN_TIMEOUT"))
        assertEquals("NETWORK_ERROR", CollectFailureClassifier.classify("EXTRACTION_TIMEOUT"))
        assertEquals("NETWORK_ERROR", CollectFailureClassifier.classify("NETWORK_ERROR"))
    }

    @Test
    fun `启动失败归为账号状态异常`() {
        assertEquals("ACCOUNT_ABNORMAL", CollectFailureClassifier.classify("LAUNCH_FAILED"))
        assertEquals("ACCOUNT_ABNORMAL", CollectFailureClassifier.classify("DEEPLINK_LAUNCH_FAILED"))
    }

    @Test
    fun `未识别的错误码归为UNKNOWN,不抛异常`() {
        assertEquals("UNKNOWN", CollectFailureClassifier.classify("SOME_FUTURE_ERROR_CODE_NOT_YET_MAPPED"))
        assertEquals("UNKNOWN", CollectFailureClassifier.classify(""))
    }

    @Test
    fun `HTTP错误码归为网络异常`() {
        assertEquals("NETWORK_ERROR", CollectFailureClassifier.classify("HTTP_500"))
        assertEquals("NETWORK_ERROR", CollectFailureClassifier.classify("HTTP_404"))
    }
}
