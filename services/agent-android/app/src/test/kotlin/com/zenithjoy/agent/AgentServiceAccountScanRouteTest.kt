package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Path2 账号扫描手动触发（sprint 07192358）：判别符测试，同 shouldRouteDmOutreach
 * 现有测试模式（AgentServiceDmTargetTest.kt:61-74）——判别符只看 payload.task_type，
 * 不看 task 顶层 type（服务端 publish_tasks.type 列默认恒为 "image"）。
 */
class AgentServiceAccountScanRouteTest {
    @Test
    fun `payload_task_type=account_scan 才路由`() {
        assertEquals(true, AgentService.shouldRouteAccountScan("account_scan"))
    }

    @Test
    fun `task_type 不是 account_scan 不路由`() {
        assertEquals(false, AgentService.shouldRouteAccountScan("warmup"))
        assertEquals(false, AgentService.shouldRouteAccountScan("dm_outreach"))
        assertEquals(false, AgentService.shouldRouteAccountScan(null))
        assertEquals(false, AgentService.shouldRouteAccountScan(""))
        assertEquals(false, AgentService.shouldRouteAccountScan("image"))
    }
}
