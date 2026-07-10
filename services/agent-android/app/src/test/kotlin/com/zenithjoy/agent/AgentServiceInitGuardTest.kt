package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机复现(2026-07-10 Honor)：`dumpsys activity services` 显示 AgentService
 * lastStartId=3 —— onStartCommand 每次都 `scope.launch { initAgent() }`，而旧的
 * keywordPollLoop / collectPollLoop 只在 onDestroy 停止。服务被多次 start（开机
 * 广播 + MainActivity + START_STICKY 重启）后就泄漏出多套并行轮询 loop，同一个
 * 采集任务每个周期被投递 N 次（logcat 实测每 30s 周期两条相隔 ~1.7s 的重复投递）。
 * initAgent 必须只执行一次。
 */
class AgentServiceInitGuardTest {

    @Test
    fun `first start runs initAgent`() {
        assertTrue(AgentService.shouldRunInitAgent(alreadyInitialized = false))
    }

    @Test
    fun `subsequent starts skip initAgent`() {
        assertFalse(AgentService.shouldRunInitAgent(alreadyInitialized = true))
    }
}
