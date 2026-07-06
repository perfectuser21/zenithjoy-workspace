package com.zenithjoy.agent.debug

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 守卫：debug-only E2E 触发器的 flow 路由是纯逻辑，必须把每个 flow 解析成正确的
 * Route + 参数，未知 flow 不能崩（返回 Unknown）。真机 UI 副作用在 onReceive 里，
 * 本测试只锁路由决策这一层，与 Android 运行时解耦。
 */
class DebugE2ERouterTest {

    private fun getterOf(vararg pairs: Pair<String, String>): (String) -> String? {
        val map = pairs.toMap()
        return { key -> map[key] }
    }

    @Test
    fun `collect flow routes to Collect with keyword and taskId`() {
        val route = DebugE2ERouter.route(
            "collect",
            getterOf("keyword" to "露营装备", "task_id" to "t1"),
        )
        assertEquals(DebugE2ERouter.Route.Collect(keyword = "露营装备", taskId = "t1"), route)
    }

    @Test
    fun `dm flow routes to Dm with all outreach fields`() {
        val route = DebugE2ERouter.route(
            "dm",
            getterOf(
                "target_douyin_id" to "douyin123",
                "message" to "你好",
                "task_id" to "t2",
                "dm_assignment_id" to "a2",
                "account_label" to "burner1",
            ),
        )
        assertEquals(
            DebugE2ERouter.Route.Dm(
                targetDouyinId = "douyin123",
                message = "你好",
                taskId = "t2",
                dmAssignmentId = "a2",
                accountLabel = "burner1",
            ),
            route,
        )
    }

    @Test
    fun `scan flow routes to Scan with request tenant device`() {
        val route = DebugE2ERouter.route(
            "scan",
            getterOf("request_id" to "r3", "tenant_id" to "ten1", "device_id" to "dev1"),
        )
        assertEquals(
            DebugE2ERouter.Route.Scan(requestId = "r3", tenantId = "ten1", deviceId = "dev1"),
            route,
        )
    }

    @Test
    fun `missing extras default to empty strings not null`() {
        val route = DebugE2ERouter.route("collect", getterOf())
        assertEquals(DebugE2ERouter.Route.Collect(keyword = "", taskId = ""), route)
    }

    @Test
    fun `unknown flow routes to Unknown without throwing`() {
        assertEquals(DebugE2ERouter.Route.Unknown, DebugE2ERouter.route("bogus", getterOf()))
        assertEquals(DebugE2ERouter.Route.Unknown, DebugE2ERouter.route(null, getterOf()))
    }
}
