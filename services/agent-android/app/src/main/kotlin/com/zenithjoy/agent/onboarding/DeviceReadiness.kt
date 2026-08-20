package com.zenithjoy.agent.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * 设备就绪度：把已有的几项判据汇成一份，随心跳上报，让客服在中台看得见
 * 「这台客户手机卡在哪一项」，而不是等客户打电话说"你们软件不好使"。
 *
 * 两条铁律：
 * 1. **判据必须用不会撒谎的那个**（铁律 2dc450f7 / 决策 44cb3e8e）——无障碍走
 *    [checkSelfAccessibility]（真 Bound + 本进程包名），不读 Secure Settings 字符串。
 *    上报假绿比不上报更糟：中台以为就绪、任务照派、静默失败。
 * 2. **设备端不算总账**——小白正在发生的「license 配额已满绑不上」设备端根本不知道，
 *    只有服务端知道，总判定由服务端合成（见 apps/api device-readiness.ts）。
 */
data class ReadinessItem(val ok: Boolean, val detail: String? = null)

const val READINESS_ACCESSIBILITY = "accessibility"
const val READINESS_VARIANT_CONFLICT = "variant_conflict"
const val READINESS_SCREEN_CAPTURE = "screen_capture"
const val READINESS_AUDIO_RECORD = "audio_record"

/** 纯函数：由各项自检结果汇成上报体。 */
fun buildDeviceReadiness(
    accessibility: AccessibilitySelfCheck,
    variant: VariantConflict,
    screenCaptureAuthorized: Boolean,
    audioRecordGranted: Boolean,
): Map<String, ReadinessItem> = mapOf(
    READINESS_ACCESSIBILITY to ReadinessItem(
        ok = accessibility.allBound,
        detail = if (accessibility.allBound) null else accessibility.describe(),
    ),
    // WARN 不算未就绪（小黄那种双包并存却工作正常的机器不能被判死），但留 detail 让客服看见隐患
    READINESS_VARIANT_CONFLICT to ReadinessItem(
        ok = !variant.verdict.blocksUsage(),
        detail = if (variant.verdict == VariantVerdict.OK) null else variant.describe(),
    ),
    READINESS_SCREEN_CAPTURE to ReadinessItem(
        ok = screenCaptureAuthorized,
        detail = if (screenCaptureAuthorized) null else "截图未授权，内容判定会一直 pending",
    ),
    READINESS_AUDIO_RECORD to ReadinessItem(
        ok = audioRecordGranted,
        detail = if (audioRecordGranted) null else "录音权限未授予，视频音频转写判定不可用",
    ),
)

/**
 * 运行时求值。**每次心跳前重新算一遍**，不做启动时的快照——
 * 就绪是会掉的状态：force-stop 后系统整体关闭无障碍（0717 真机复现）、
 * `adb install -r` 静默撤销无障碍（0803 真机复现）。快照就是又一个假绿。
 */
fun currentDeviceReadiness(
    context: Context,
    screenCaptureAuthorized: Boolean,
): Map<String, ReadinessItem> = buildDeviceReadiness(
    accessibility = checkSelfAccessibility(context),
    variant = checkVariantConflict(context),
    screenCaptureAuthorized = screenCaptureAuthorized,
    audioRecordGranted = ContextCompat.checkSelfPermission(
        context, Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED,
)
