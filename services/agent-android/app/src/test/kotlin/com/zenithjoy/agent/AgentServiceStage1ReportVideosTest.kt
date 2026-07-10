package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 验证 AgentService Stage1 视频清单回报逻辑。
 *
 * AgentService 本体依赖 Android 框架（Service/AccessibilityService/BroadcastReceiver），
 * 不能在纯 JVM 单元测试中直接实例化。这里提取可测逻辑为静态方法，验证请求体构造正确性。
 *
 * 集成层行为（真实 HTTP 调用 report-videos 端点）由 smoke 脚本
 * android-collect-protocol-v2-smoke.sh 覆盖。
 */
class AgentServiceStage1ReportVideosTest {

    // TC-S1-001: 正常找到视频 → body 含 videos 数组，keyword 作为 video_id
    @Test
    fun `buildStage1VideosBody_ok_includesVideoWithKeyword`() {
        val body = AgentService.buildStage1VideosBody(
            taskId = "task-001",
            keyword = "关键词A",
            ok = true,
            error = "",
        )
        assertTrue("应包含 task_id", body.contains("\"task_id\":\"task-001\""))
        assertTrue("应包含 videos 数组", body.contains("\"videos\""))
        assertTrue("video_id 应是关键词", body.contains("\"video_id\":\"关键词A\""))
        assertTrue("不应包含 reason", !body.contains("\"reason\""))
    }

    // TC-S1-002: 搜索结果为空（ok=false, error=""） → reason.search_result=empty
    @Test
    fun `buildStage1VideosBody_emptyResult_includesSearchResultEmpty`() {
        val body = AgentService.buildStage1VideosBody(
            taskId = "task-002",
            keyword = "关键词B",
            ok = false,
            error = "",
        )
        assertTrue("应包含空 videos 数组", body.contains("\"videos\":[]"))
        assertTrue("应包含 search_result=empty", body.contains("\"search_result\":\"empty\""))
    }

    // TC-S1-003: 搜索出错（ok=false, error="LAUNCH_FAILED"） → reason.error_code
    @Test
    fun `buildStage1VideosBody_error_includesErrorCode`() {
        val body = AgentService.buildStage1VideosBody(
            taskId = "task-003",
            keyword = "关键词C",
            ok = false,
            error = "LAUNCH_FAILED",
        )
        assertTrue("应包含空 videos 数组", body.contains("\"videos\":[]"))
        assertTrue("应包含 error_code", body.contains("\"error_code\":\"LAUNCH_FAILED\""))
    }
}
