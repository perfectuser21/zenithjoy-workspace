package com.zenithjoy.agent

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Line02 Step7 账号扫描结果上报纯逻辑单测（JVM，不起 Android）：
 * buildAccountScanResultBody：组 POST /api/agent/burner/account-scan-result 的 body
 * （纯字符串拼，避 org.json 陷阱，与 buildWarmupResultBody 同套路）。
 */
class AgentServiceAccountScanTest {
    @Test
    fun builds_account_scan_result_body_with_fields_and_ids() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req1",
            agentId = "a1",
            ok = true,
            stale = false,
            accountIds = listOf("大湖", "秦军餐饮"),
            errorCode = "",
        )
        assertTrue(body.contains("\"request_id\":\"req1\""))
        assertTrue(body.contains("\"agent_id\":\"a1\""))
        assertTrue(body.contains("\"ok\":true"))
        assertTrue(body.contains("\"stale\":false"))
        assertTrue(body.contains("\"account_ids\":[\"大湖\",\"秦军餐饮\"]"))
        assertTrue(body.contains("\"error_code\":\"\""))
    }

    @Test
    fun empty_account_ids_becomes_empty_array() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req2", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "OPEN_PANEL_FAILED",
        )
        assertTrue(body.contains("\"account_ids\":[]"))
        assertTrue(body.contains("\"ok\":false"))
        assertTrue(body.contains("\"error_code\":\"OPEN_PANEL_FAILED\""))
    }

    @Test
    fun escapes_quotes_in_string_fields() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "r\"1", agentId = "a1", ok = true, stale = false,
            accountIds = listOf("测\"号"), errorCode = "",
        )
        assertTrue(body.contains("r\\\"1"))
        assertTrue(body.contains("测\\\"号"))
    }

    @Test
    fun builds_account_scan_result_body_with_screenshot_and_tree_dump_when_present() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "OPEN_PANEL_FAILED",
            screenshotB64 = "ZmFrZWJhc2U2NA==", treeDump = "line1\nline2",
        )
        assertTrue(body.contains("\"screenshot_b64\":\"ZmFrZWJhc2U2NA==\""))
        assertTrue(body.contains("\"tree_dump\""))
        assertTrue(body.contains("line1"))
    }

    @Test
    fun builds_account_scan_result_body_without_screenshot_fields_when_null() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req2", agentId = "a1", ok = true, stale = false,
            accountIds = listOf("大湖"), errorCode = "",
            screenshotB64 = null, treeDump = null,
        )
        assertTrue(body.contains("\"screenshot_b64\":null"))
        assertTrue(body.contains("\"tree_dump\":null"))
    }

    @Test
    fun escapes_newlines_and_quotes_in_tree_dump() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "r1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "READ_FAILED",
            screenshotB64 = null, treeDump = "desc=\"切换账号\"\nline2",
        )
        // 必须是合法 JSON——换行符和引号都要转义，不能原样嵌进字符串字面量把 JSON 打断
        assertTrue(body.contains("\\n"))
        assertTrue(body.contains("\\\""))
    }

    @Test
    fun escapes_carriage_return_and_tab_in_tree_dump() {
        // 真机安卓设备的无障碍树摘要可能带 Windows 换行(\r\n)或制表符(\t)；
        // 这两个 C0 控制字符若原样嵌进 JSON 字符串字面量，会让整段 request body 解析失败
        // （不只丢 tree_dump，连 ok/account_ids/error_code 都读不到）。
        val rawTreeDump = "line1\r\nline2\tindented"
        val body = AgentService.buildAccountScanResultBody(
            requestId = "r1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "READ_FAILED",
            screenshotB64 = null, treeDump = rawTreeDump,
        )

        // 第一层：body 文本里不能残留裸 \r / \t 字符，必须是转义后的双字符序列 \r \t
        assertTrue(!body.contains("\r"))
        assertTrue(!body.contains("\t"))
        assertTrue(body.contains("\\r"))
        assertTrue(body.contains("\\t"))

        // 第二层（更强）：用真实 JSON 解析器解析整段 body，确认它本身就是合法 JSON，
        // 且 tree_dump 字段反解出来的值与原始输入完全一致（往返无损）
        val parsed = JSONObject(body)
        assertEquals(rawTreeDump, parsed.getString("tree_dump"))
    }
}
