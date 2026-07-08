package com.zenithjoy.agent

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
}
