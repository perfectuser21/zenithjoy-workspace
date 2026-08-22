package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * AI on-call 刀2b：定位求助客户端纯逻辑（请求构造 / 响应解析 / bounds 中心点 / 回执构造）。
 *
 * IO 薄层（OkHttp 同步调用）不进 JVM 测——同 FailureScene/UiTreeSnapshot 的分层纪律。
 * fail-open 由解析层保证：任何不认识的响应形状一律解析成"没有答案"，
 * 调用方走原失败路径，保底通道绝不反成新的崩溃点。
 */
class LocatorAssistClientTest {

    @Test
    fun `请求体带全六要素——step-target-树-错误码-设备-版本`() {
        val body = LocatorAssistClient.buildAssistBody(
            step = "dm_search_input",
            targetDesc = "搜索关键词输入框",
            uiTree = "d0 android.widget.FrameLayout id=- text=\"-\"",
            errorCode = "NO_SEARCH_INPUT",
            deviceModel = "HONOR ANY-AN00",
            osVersion = "Android 12 (API 31)",
            douyinVersion = "28.5.0",
            appVersion = "2.1.37",
        )
        for (key in listOf(
            "\"step\":", "\"target_desc\":", "\"ui_tree_snapshot\":", "\"error_code\":",
            "\"device_model\":", "\"os_version\":", "\"douyin_version\":", "\"app_version\":",
        )) {
            assertTrue("请求体缺 $key", body.contains(key))
        }
        assertTrue(body.contains("dm_search_input"))
    }

    @Test
    fun `ok 响应解析出 assist_id 与候选`() {
        val json = """{"success":true,"data":{"status":"ok","assist_id":"aid-123","cache_hit":false,
            "backend":"tree-llm","candidates":[{"line":2,"view_id":"com.ss:id/et","text":null,
            "content_desc":"搜索输入框","bounds":"[100,80][900,160]"}]}}"""
        val r = LocatorAssistClient.parseAssistResponse(json)!!
        assertEquals("aid-123", r.assistId)
        assertEquals(1, r.candidates.size)
        assertEquals("com.ss:id/et", r.candidates[0].viewId)
        assertEquals("[100,80][900,160]", r.candidates[0].bounds)
    }

    @Test
    fun `unavailable 响应解析为 null——调用方走原失败路径`() {
        val json = """{"success":true,"data":{"status":"unavailable","reason":"llm_timeout"}}"""
        assertNull(LocatorAssistClient.parseAssistResponse(json))
    }

    @Test
    fun `畸形响应解析为 null 不抛异常——保底通道绝不反成崩溃点`() {
        assertNull(LocatorAssistClient.parseAssistResponse("not json at all"))
        assertNull(LocatorAssistClient.parseAssistResponse("{\"success\":false}"))
        assertNull(LocatorAssistClient.parseAssistResponse(""))
    }

    @Test
    fun `view_id 占位符 - 解析为 null`() {
        val json = """{"success":true,"data":{"status":"ok","assist_id":"a","cache_hit":true,
            "candidates":[{"line":0,"view_id":null,"text":null,"content_desc":null,"bounds":"[0,0][10,10]"}]}}"""
        val r = LocatorAssistClient.parseAssistResponse(json)!!
        assertNull(r.candidates[0].viewId)
    }

    @Test
    fun `bounds 中心点计算——手势兜底的落点`() {
        assertEquals(Pair(500, 120), LocatorAssistClient.boundsCenter("[100,80][900,160]"))
        assertNull(LocatorAssistClient.boundsCenter("garbage"))
        assertNull(LocatorAssistClient.boundsCenter(null))
    }

    @Test
    fun `verified 回执体——true-false 都能构造`() {
        val ok = LocatorAssistClient.buildVerifyBody("aid-123", true)
        assertTrue(ok.contains("aid-123"))
        assertTrue(ok.contains("true"))
        val bad = LocatorAssistClient.buildVerifyBody("aid-123", false)
        assertTrue(bad.contains("false"))
    }
}
