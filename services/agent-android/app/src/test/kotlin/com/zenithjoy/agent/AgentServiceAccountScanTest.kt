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

    // ── sprint 08031620-android-scan-preconditions：新增 versionName/stage/foregroundPackage 三字段透传 ──
    // 服务端 apps/api/src/routes/agent-burner.ts 目前只解构 screenshot_b64/tree_dump 等既有字段，
    // 若不把这三个新字段跟着这条链路走到位，PRD 要求的"运维免登真机排障"就落空——见 contract-draft.md 范围修正说明。

    @Test
    fun builds_account_scan_result_body_with_new_diagnostic_fields_when_present() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "SCREEN_LOCKED",
            versionName = "2.1.20", stage = "lock_check", foregroundPackage = "com.android.systemui",
        )
        assertTrue(body.contains("\"version_name\":\"2.1.20\""))
        assertTrue(body.contains("\"stage\":\"lock_check\""))
        assertTrue(body.contains("\"foreground_package\":\"com.android.systemui\""))
    }

    @Test
    fun builds_account_scan_result_body_without_new_diagnostic_fields_when_null() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req2", agentId = "a1", ok = true, stale = false,
            accountIds = listOf("大湖"), errorCode = "",
        )
        assertTrue(body.contains("\"version_name\":null"))
        assertTrue(body.contains("\"stage\":null"))
        assertTrue(body.contains("\"foreground_package\":null"))
    }

    @Test
    fun new_diagnostic_fields_body_is_valid_json_round_trip() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req3", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "LAUNCH_BLOCKED",
            versionName = "2.1.20", stage = "launch_wait", foregroundPackage = "com.coloros.wallpapers",
        )
        val parsed = JSONObject(body)
        assertEquals("2.1.20", parsed.getString("version_name"))
        assertEquals("launch_wait", parsed.getString("stage"))
        assertEquals("com.coloros.wallpapers", parsed.getString("foreground_package"))
    }

    // ── 本次bug修复：新增 screenshotFailureReason（诊断截图为什么拿不到）+ douyinVersionName
    // （设备上抖音真实版本号，代替代码注释里硬编码假设的"抖音39.4.0"）两个透传字段。
    // 服务端 apps/api/src/routes/agent-burner.ts 的 /account-scan-result 需要跟着接住，
    // 否则这两个字段会在手机端序列化好、服务端却从未落库，等于白采集——同 sprint
    // 08031620 versionName/stage/foregroundPackage 三字段当年踩过的同一个坑。

    @Test
    fun builds_account_scan_result_body_with_screenshot_failure_reason_and_douyin_version_when_present() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req4", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "OPEN_PANEL_FAILED",
            screenshotFailureReason = "service_null", douyinVersionName = "39.5.0",
        )
        assertTrue(body.contains("\"screenshot_failure_reason\":\"service_null\""))
        assertTrue(body.contains("\"douyin_version_name\":\"39.5.0\""))
    }

    @Test
    fun builds_account_scan_result_body_without_screenshot_failure_reason_fields_when_null() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req5", agentId = "a1", ok = true, stale = false,
            accountIds = listOf("大湖"), errorCode = "",
        )
        assertTrue(body.contains("\"screenshot_failure_reason\":null"))
        assertTrue(body.contains("\"douyin_version_name\":null"))
    }

    @Test
    fun screenshot_failure_reason_and_douyin_version_round_trip_as_valid_json() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req6", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "OPEN_PANEL_FAILED",
            screenshotFailureReason = "capture_threw:boom", douyinVersionName = "39.5.0",
        )
        val parsed = JSONObject(body)
        assertEquals("capture_threw:boom", parsed.getString("screenshot_failure_reason"))
        assertEquals("39.5.0", parsed.getString("douyin_version_name"))
    }
}
