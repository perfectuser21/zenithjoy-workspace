package com.zenithjoy.agent.uia

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.delay

/**
 * 单次探测的快照：目标值 + 用于事后诊断的环境信息。
 */
data class ProbeSnapshot<T : Any>(
    val target: T?,
    val rootPresent: Boolean,
    val foregroundPkg: String?,
)

/**
 * 轮询结果：命中值 + 实际轮询次数 + 全程观察到的环境事实。
 */
data class PollOutcome<T : Any>(
    val value: T?,
    val attempts: Int,
    val everSawRoot: Boolean,
    val lastForegroundPkg: String?,
) {
    val hit: Boolean get() = value != null

    /** 实际等待时长 = 间隔数 × interval（N 次探测之间只有 N-1 个间隔）。 */
    fun waitedMs(intervalMs: Long): Long = (attempts - 1).coerceAtLeast(0) * intervalMs
}

/**
 * 等待失败的三种现实原因——让下一次真机排查不必再考古。
 */
enum class WaitFailure {
    /** 全程没拿到根节点：无障碍服务被撤销/未绑定。 */
    NO_ROOT,

    /** 拿到了根节点但前台始终不是期望包：厂商开屏广告/系统弹窗盖住。 */
    WRONG_FOREGROUND,

    /** 前台就是期望包，但目标节点始终没出现：页面没加载完，或抖音改版。 */
    TARGET_ABSENT,
}

/**
 * 无障碍「等到条件满足再动作」的唯一设施。
 *
 * 背景（2026-08-18）：三个 Service 原先各自持有一份 `awaitRootInActiveWindow`，语义是
 * 「等屏幕上出现任何窗口」——抖音闪屏页、荣耀系统管家 AppSplashAdvertiseActivity 开屏广告页
 * 都满足它，于是在半成品页面上找节点，找不到就判死。同一个 NO_SEARCH_INPUT 因此被修过四次
 * （#1120 点击后快照 / #1375 状态竞态 / #1640 iAware 拉起 / 本次点击前时机）。
 *
 * 真机 A/B 对照（荣耀 X30 / Android 13 / 抖音 40.0.0）：抖音进程已热时 searchBtn=true 采到 3 张卡；
 * force-stop 冷启动时 searchBtn=false 直接失败。同设备同选择器，差别只在时机。
 *
 * 与 [com.zenithjoy.agent.collect.SnapshotDiscipline] 互补：那个防「点击后复用旧快照」（太晚），
 * 这个防「目标出现前就判定」（太早）。
 */
object NodeAwait {

    /**
     * 轮询直到 [probe] 给出非空 target，或用尽 [maxAttempts]。
     *
     * 语义：**先 probe，未命中再 sleep**——页面已就绪时零额外延迟。
     * 超时返回 `value = null`，**绝不兜底返回可能过期的快照**
     * （旧实现 `return rootInActiveWindow` 会退回点击前的旧 root）。
     *
     * [sleep] 与 [probe] 均可注入，因此本函数可在 JVM 单测中不依赖 Android 框架、不消耗真实时间地验证。
     */
    suspend fun <T : Any> pollUntilPresent(
        maxAttempts: Int,
        intervalMs: Long,
        sleep: suspend (Long) -> Unit,
        probe: () -> ProbeSnapshot<T>,
    ): PollOutcome<T> {
        var everSawRoot = false
        var lastPkg: String? = null
        var attempts = 0
        repeat(maxAttempts) {
            attempts++
            val snap = probe()
            if (snap.rootPresent) everSawRoot = true
            if (snap.foregroundPkg != null) lastPkg = snap.foregroundPkg
            snap.target?.let { return PollOutcome(it, attempts, everSawRoot, lastPkg) }
            if (attempts < maxAttempts) sleep(intervalMs)
        }
        return PollOutcome(null, attempts, everSawRoot, lastPkg)
    }

    /**
     * 把一次失败的等待归入 [WaitFailure] 三态之一。[expectedPkg] 为 null 表示不校验前台包名。
     */
    fun classifyFailure(outcome: PollOutcome<*>, expectedPkg: String?): WaitFailure = when {
        !outcome.everSawRoot -> WaitFailure.NO_ROOT
        expectedPkg != null && outcome.lastForegroundPkg != expectedPkg -> WaitFailure.WRONG_FOREGROUND
        else -> WaitFailure.TARGET_ABSENT
    }
}

/**
 * 在本 Service 的活动窗口上轮询等待 [finder] 命中的节点。
 *
 * 每一轮直接读一次 `rootInActiveWindow`（**不再嵌套调用自带等待的函数**——dm 原 `awaitNode`
 * 内部调 `awaitRootInActiveWindow()`，每轮又藏了最多 4 秒，真实上限不可控）。
 * 因此本函数耗时严格等于 `maxAttempts × intervalMs`。
 *
 * 前台包名总是记进 [PollOutcome]，与期望包的比对由调用方在失败时交给 [NodeAwait.classifyFailure]。
 * 默认值对齐 dm 原私有 awaitNode（6 次 × 500ms），使其既有调用点可平滑迁移。
 *
 * 等「状态成立」而非「节点出现」的场景，用 `root.takeIf { ... }` 把 root 自身作为命中值。
 */
suspend fun AccessibilityService.awaitNode(
    maxAttempts: Int = 6,
    intervalMs: Long = 500L,
    finder: (AccessibilityNodeInfo) -> AccessibilityNodeInfo?,
): PollOutcome<AccessibilityNodeInfo> =
    NodeAwait.pollUntilPresent(maxAttempts, intervalMs, { delay(it) }) {
        val root = rootInActiveWindow
        ProbeSnapshot(
            target = root?.let(finder),
            rootPresent = root != null,
            foregroundPkg = root?.packageName?.toString(),
        )
    }
