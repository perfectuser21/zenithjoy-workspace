package com.zenithjoy.agent.debug

/**
 * DEBUG_E2E 广播的纯路由逻辑（与 Android 运行时解耦，便于单测）。
 * 把 flow + extras 解析成一个 [Route]，由 [DebugE2ETriggerReceiver] 负责真正执行副作用。
 */
object DebugE2ERouter {
    sealed interface Route {
        data class Collect(val keyword: String, val taskId: String) : Route
        data class Dm(
            val targetDouyinId: String,
            val message: String,
            val taskId: String,
            val dmAssignmentId: String,
            val accountLabel: String,
        ) : Route
        data class Scan(val requestId: String, val tenantId: String, val deviceId: String) : Route
        data class Warmup(val requestId: String, val deviceId: String, val operatorNickname: String) : Route
        object Unknown : Route
    }

    /** extra 缺失时统一降级为空串（不返回 null），与生产 dispatchTask 的空串语义一致。 */
    fun route(flow: String?, extra: (String) -> String?): Route = when (flow) {
        "collect" -> Route.Collect(
            keyword = extra("keyword").orEmpty(),
            taskId = extra("task_id").orEmpty(),
        )
        "dm" -> Route.Dm(
            targetDouyinId = extra("target_douyin_id").orEmpty(),
            message = extra("message").orEmpty(),
            taskId = extra("task_id").orEmpty(),
            dmAssignmentId = extra("dm_assignment_id").orEmpty(),
            accountLabel = extra("account_label").orEmpty(),
        )
        "scan" -> Route.Scan(
            requestId = extra("request_id").orEmpty(),
            tenantId = extra("tenant_id").orEmpty(),
            deviceId = extra("device_id").orEmpty(),
        )
        "warmup" -> Route.Warmup(
            requestId = extra("request_id").orEmpty(),
            deviceId = extra("device_id").orEmpty(),
            operatorNickname = extra("operator_nickname").orEmpty(),
        )
        else -> Route.Unknown
    }
}
