package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Line02 warmup 接线纯逻辑单测（JVM，不起 Android）：
 *  - shouldRouteWarmup：判别符走 payload.task_type=='warmup'
 *  - buildWarmupResultBody：组 POST /api/agent/burner/warmup-result 的 body（纯字符串拼，避 org.json 陷阱）
 */
class AgentServiceWarmupTest {
    @Test
    fun routes_only_on_payload_task_type_warmup() {
        assertTrue(AgentService.shouldRouteWarmup("warmup"))
        assertFalse(AgentService.shouldRouteWarmup("dm_outreach"))
        assertFalse(AgentService.shouldRouteWarmup(null))
        assertFalse(AgentService.shouldRouteWarmup(""))
    }

    @Test
    fun builds_warmup_result_body_with_fields_and_raw_results() {
        val results = "[{\"nickname\":\"大湖\",\"alive\":true,\"followers\":1196,\"reason\":\"ok\"}]"
        val body = AgentService.buildWarmupResultBody("r1", "dev1", "a1", 2, 1, 1, results, "")
        assertTrue(body.contains("\"task_id\":\"r1\""))
        assertTrue(body.contains("\"agent_id\":\"a1\""))
        assertTrue(body.contains("\"device_id\":\"dev1\""))
        assertTrue(body.contains("\"total\":2"))
        assertTrue(body.contains("\"alive\":1"))
        assertTrue(body.contains("\"offline\":1"))
        assertTrue(body.contains("\"results\":[{\"nickname\":\"大湖\""))
        assertTrue(body.contains("\"error_code\":\"\""))
    }

    @Test
    fun blank_results_becomes_empty_array() {
        val body = AgentService.buildWarmupResultBody("r1", "d", "a", 0, 0, 0, "", "MUTEX_BUSY")
        assertTrue(body.contains("\"results\":[]"))
        assertTrue(body.contains("\"error_code\":\"MUTEX_BUSY\""))
    }

    @Test
    fun escapes_quotes_in_string_fields() {
        val body = AgentService.buildWarmupResultBody("r1", "d", "a", 0, 0, 0, "[]", "MU\"TEX")
        assertTrue(body.contains("MU\\\"TEX"))
    }
}
