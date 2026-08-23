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

    @Test
    fun `extract 请求体带 mode=extract`() {
        val body = LocatorAssistClient.buildAssistBody(
            step = "collect_read_douyin_id", targetDesc = "这个人的抖音号",
            uiTree = "d0 x", errorCode = "DOUYIN_ID_NOT_FOUND",
            deviceModel = "HONOR", osVersion = "12", douyinVersion = "28.5.0", appVersion = "2.1.38",
            mode = "extract",
        )
        assertTrue(body.contains("\"mode\":\"extract\""))
    }

    @Test
    fun `extract 响应解析出 extracted_value`() {
        val json = """{"success":true,"data":{"status":"ok","assist_id":"a","mode":"extract","extracted_value":"dy_zhang_88"}}"""
        val v = LocatorAssistClient.parseExtractResponse(json)
        assertEquals("dy_zhang_88", v?.first)
        assertEquals("a", v?.second)
    }

    @Test
    fun `extract unavailable 或畸形解析为 null`() {
        assertNull(LocatorAssistClient.parseExtractResponse("""{"success":true,"data":{"status":"unavailable"}}"""))
        assertNull(LocatorAssistClient.parseExtractResponse("garbage"))
    }

    // ── 铺满第三批：extract_list（多值提取，如扫号链读账号昵称列表）──────────────
    @Test
    fun `extract_list 请求体带 mode=extract_list`() {
        val body = LocatorAssistClient.buildAssistBody(
            step = "scan_account_list", targetDesc = "所有已登录账号的昵称",
            uiTree = "d0 x", errorCode = "NO_ACCOUNT_LIST",
            deviceModel = "HONOR", osVersion = "12", douyinVersion = "28.5.0", appVersion = "2.1.44",
            mode = "extract_list",
        )
        assertTrue(body.contains("\"mode\":\"extract_list\""))
    }

    @Test
    fun `extract_list 响应解析出 extracted_values 列表`() {
        val json = """{"success":true,"data":{"status":"ok","assist_id":"a","mode":"extract_list","extracted_values":["张三","李四"]}}"""
        val v = LocatorAssistClient.parseExtractListResponse(json)
        assertEquals(listOf("张三", "李四"), v?.first)
        assertEquals("a", v?.second)
    }

    @Test
    fun `extract_list 真答出空列表也解析成功——AI确认没有不等于失败`() {
        val json = """{"success":true,"data":{"status":"ok","assist_id":"a","mode":"extract_list","extracted_values":[]}}"""
        val v = LocatorAssistClient.parseExtractListResponse(json)
        assertEquals(emptyList<String>(), v?.first)
        assertEquals("a", v?.second)
    }

    @Test
    fun `extract_list unavailable 或畸形解析为 null`() {
        assertNull(LocatorAssistClient.parseExtractListResponse("""{"success":true,"data":{"status":"unavailable"}}"""))
        assertNull(LocatorAssistClient.parseExtractListResponse("garbage"))
        // extracted_values 字段缺失/为 null（真失败）跟 [](AI确认没有)必须区分
        assertNull(LocatorAssistClient.parseExtractListResponse("""{"success":true,"data":{"status":"ok","assist_id":"a"}}"""))
    }

    // ── 刀B2：vision_select（截图选结果行）──────────────────────────────────
    @Test
    fun `vision 请求体带 mode=vision_select 与截图`() {
        val body = LocatorAssistClient.buildAssistBody(
            step = "dm_result_select", targetDesc = "抖音号 zz_88",
            uiTree = "", errorCode = "NO_MATCH",
            deviceModel = "HONOR", osVersion = "12", douyinVersion = "40.0.0", appVersion = "2.1.41",
            mode = "vision_select", screenshotB64 = "ZmFrZQ==", visionCandidateCount = 8,
        )
        assertTrue(body.contains("\"mode\":\"vision_select\""))
        assertTrue(body.contains("\"screenshot_b64\":\"ZmFrZQ==\""))
        assertTrue(body.contains("\"vision_candidate_count\":8"))
    }

    @Test
    fun `vision 响应解析 match_index（含 -1）`() {
        assertEquals(2, LocatorAssistClient.parseVisionResponse("""{"success":true,"data":{"status":"ok","assist_id":"a","match_index":2}}""")?.first)
        assertEquals(-1, LocatorAssistClient.parseVisionResponse("""{"success":true,"data":{"status":"ok","match_index":-1}}""")?.first)
        assertNull(LocatorAssistClient.parseVisionResponse("""{"success":true,"data":{"status":"unavailable"}}"""))
        assertNull(LocatorAssistClient.parseVisionResponse("garbage"))
    }

    @Test
    fun `行坐标 row0 加 idx 乘 pitch`() {
        assertEquals(0.21f, LocatorAssistClient.rowFractionForIndex(0), 0.0001f)
        assertEquals(0.21f + 0.084f, LocatorAssistClient.rowFractionForIndex(1), 0.0001f)
        assertEquals(0.21f + 2 * 0.084f, LocatorAssistClient.rowFractionForIndex(2), 0.0001f)
        // 负数被夹到 0（row0）
        assertEquals(0.21f, LocatorAssistClient.rowFractionForIndex(-5), 0.0001f)
    }
}
