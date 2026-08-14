package com.zenithjoy.agent.account

/**
 * OPEN_PANEL_FAILED 大杂烩拆分层的核心判定纯函数（sprint 08031620-android-scan-preconditions）。
 * 用两条真实历史失败记录确诊两类独立根因：
 *   - 锁屏（07-31, agent_scan_failures.id da659ea0）：tree_dump 含系统锁屏特征文案"上滑解锁"
 *   - 桌面 launcher（07-30, agent_scan_failures.id 236f43b1，realme RMX3478/ColorOS）：
 *     tree_dump 呈现桌面图标列表（拨号/微信/抖音/ZenithJoy Agent 等应用图标并列），且不含
 *     既有代码已依赖的正常态标记文本（"我，按钮"/"切换账号"）。
 * 纯函数，无 Android 框架依赖，JVM 单测直接验证；真机真实触发场景由 nightly
 * account-scan-realmachine-smoke.sh 车道回归覆盖（未覆盖真实链路清单，见 contract-draft.md）。
 */
object AccountScanFailureClassifier {

    private const val LOCK_SCREEN_MARKER = "上滑解锁"

    // 正常态既有代码依赖的标记文本——出现即不应判定为锁屏/桌面 launcher（假阳性防护）
    private val NORMAL_STATE_MARKERS = listOf("我，按钮", "切换账号")

    // 桌面 launcher 典型应用图标标签（非详尽枚举，命中任意 2 个及以上视为桌面特征）
    private val LAUNCHER_ICON_MARKERS = listOf("拨号", "相机", "设置", "时钟", "浏览器", "ZenithJoy Agent")

    fun isLockScreenTreeDump(treeDumpText: String?): Boolean {
        if (treeDumpText.isNullOrBlank()) return false
        if (NORMAL_STATE_MARKERS.any { treeDumpText.contains(it) }) return false
        return treeDumpText.contains(LOCK_SCREEN_MARKER)
    }

    fun isHomeLauncherTreeDump(treeDumpText: String?): Boolean {
        if (treeDumpText.isNullOrBlank()) return false
        if (NORMAL_STATE_MARKERS.any { treeDumpText.contains(it) }) return false
        if (treeDumpText.contains(LOCK_SCREEN_MARKER)) return false
        val hitCount = LAUNCHER_ICON_MARKERS.count { treeDumpText.contains(it) }
        return hitCount >= 2
    }

    /**
     * 诊断截图捕获失败原因分类（真机复现 08-11 run 31427538362，task_id=8a251802-...确诊）：
     * captureFailureDiagnostics() 此前用一个 try/catch 把"服务未初始化(sharedScreenCaptureService
     * 为null)"/"截图返回null(服务可用、无异常，但就是没拍到)"/"截图过程抛异常"三种不同原因
     * 静默坍缩成同一个不可区分的 null——DB screenshot_b64 恒为 null，导致历次 OPEN_PANEL_FAILED
     * 现场都无法判断截图诊断本身为什么瞎。返回 null 代表截图捕获成功（不是失败）。
     */
    fun classifyScreenshotCaptureFailure(
        serviceAvailable: Boolean,
        threwMessage: String?,
        resultIsNull: Boolean,
    ): String? {
        if (!serviceAvailable) return "service_null"
        if (threwMessage != null) return "capture_threw:$threwMessage"
        if (resultIsNull) return "capture_returned_null"
        return null
    }
}
