package com.zenithjoy.agent

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 真机复现(2026-07-13 Honor xian-rog, PID 19673)：AgentService.onCreate 无条件用
 * DATA_SYNC|MEDIA_PROJECTION 两种 type 调 startForeground，但此时 MediaProjectionHolder
 * 还没有任何授权(用户还没点过 MainActivity「授权截屏」)。Android 14 要求声明
 * MEDIA_PROJECTION type 的 FGS 必须已持有有效 MediaProjection 令牌，否则系统直接抛
 * SecurityException 杀死整个服务(不只是截图功能 pending，是 Agent 完全启动不了)：
 *   java.lang.SecurityException: Starting FGS with type mediaProjection ... requires
 *   permissions: all of the permissions allOf=true [FOREGROUND_SERVICE_MEDIA_PROJECTION]
 *   any of the permissions allOf=false [CAPTURE_VIDEO_OUTPUT, android:project_media]
 *   at AgentService.startForegroundCompat(AgentService.kt:508)
 *   at AgentService.onCreate(AgentService.kt:154)
 *
 * 违反了 MainActivity 头部注释的设计意图："用户拒绝也不阻塞 Agent 启动"——
 * 必须只在已有 MediaProjection 授权时才声明 MEDIA_PROJECTION type，未授权时退化成
 * 纯 DATA_SYNC，等用户后续授权后再升级。
 */
class AgentServiceForegroundTypeTest {

    @Test
    fun `no media projection authorization yet degrades to data sync only`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            AgentService.foregroundServiceTypeFlags(hasMediaProjectionAuthorization = false),
        )
    }

    @Test
    fun `media projection authorized promotes to data sync plus media projection`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            AgentService.foregroundServiceTypeFlags(hasMediaProjectionAuthorization = true),
        )
    }
}
