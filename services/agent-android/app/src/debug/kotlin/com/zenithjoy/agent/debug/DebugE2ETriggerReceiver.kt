package com.zenithjoy.agent.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.zenithjoy.agent.account.DeviceAccountScanService
import com.zenithjoy.agent.collect.DouyinCollectService
import com.zenithjoy.agent.collect.DouyinDmOutreachService

/**
 * 仅 debug 变体存在的真机 E2E 触发器。
 *
 * 生产链路里 collect / dm_outreach / account_scan 三个内部广播接收器都注册为
 * RECEIVER_NOT_EXPORTED（只接收同 App/同 UID 的广播），任务只从中台服务器轮询下发。
 * 这在生产是对的（防外部伪造任务），但让真机端到端验证没有 adb 可驱动的入口——
 * agent 没配 license 时整条链根本没法手动跑起来给人看。
 *
 * 本接收器只编进 debug 包（src/debug 源集），线上 release 包里不存在。它收到
 * 外部（adb shell）发来的 DEBUG_E2E 广播后，在 App 进程内转调与服务器路径
 * **完全相同**的静态 dispatchTask 方法——因此设备端执行的是一模一样的生产代码，
 * 唯一差别是"任务来自 adb 而非服务器轮询"（服务器往返那段另有单测覆盖）。
 *
 * 用法：
 *   adb shell am broadcast -a com.zenithjoy.agent.DEBUG_E2E -p com.zenithjoy.agent \
 *     --es flow collect --es keyword "露营装备" --es task_id t1
 *   adb shell am broadcast -a com.zenithjoy.agent.DEBUG_E2E -p com.zenithjoy.agent \
 *     --es flow dm --es target_douyin_id "<抖音号>" --es message "你好" \
 *     --es task_id t2 --es dm_assignment_id a2 --es account_label burner1
 *   adb shell am broadcast -a com.zenithjoy.agent.DEBUG_E2E -p com.zenithjoy.agent \
 *     --es flow scan --es request_id r3 --es device_id dev1
 */
class DebugE2ETriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        val ctx = context?.applicationContext ?: return
        if (intent?.action != ACTION_DEBUG_E2E) return
        when (val route = DebugE2ERouter.route(intent.getStringExtra("flow")) { intent.getStringExtra(it) }) {
            is DebugE2ERouter.Route.Collect -> {
                Log.i(TAG, "DEBUG_E2E collect: keyword=${route.keyword} taskId=${route.taskId}")
                DouyinCollectService.dispatchTask(ctx, route.keyword, route.taskId)
            }
            is DebugE2ERouter.Route.Dm -> {
                Log.i(TAG, "DEBUG_E2E dm: target=${route.targetDouyinId} taskId=${route.taskId}")
                DouyinDmOutreachService.dispatchTask(
                    ctx,
                    route.targetDouyinId,
                    route.message,
                    route.taskId,
                    route.dmAssignmentId,
                    route.accountLabel,
                )
            }
            is DebugE2ERouter.Route.Scan -> {
                Log.i(TAG, "DEBUG_E2E scan: requestId=${route.requestId} deviceId=${route.deviceId}")
                DeviceAccountScanService.dispatchTask(ctx, route.requestId, route.tenantId, route.deviceId)
            }
            is DebugE2ERouter.Route.Warmup -> {
                Log.i(TAG, "DEBUG_E2E warmup: requestId=${route.requestId} operator=${route.operatorNickname}")
                DeviceAccountScanService.dispatchWarmupTask(ctx, route.requestId, route.deviceId, route.operatorNickname)
            }
            DebugE2ERouter.Route.Unknown ->
                Log.w(TAG, "DEBUG_E2E unknown flow: ${intent.getStringExtra("flow")}")
        }
    }

    companion object {
        private const val TAG = "DebugE2ETrigger"
        const val ACTION_DEBUG_E2E = "com.zenithjoy.agent.DEBUG_E2E"
    }
}
