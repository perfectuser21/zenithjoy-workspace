package com.zenithjoy.agent.uia

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
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
     * 厂商插屏/授权框该点哪个按钮。纯函数，输入是当前页面上收集到的全部文案。
     *
     * 真机实证（荣耀 X30 / MagicOS，2026-08-18）：冷启动抖音时
     * `com.hihonor.systemmanager/…AppSplashAdvertiseActivity` 会盖在抖音之上，
     * 此时前台包名不是抖音，只靠「等目标节点出现」永远等不到（实测等满 24 次 11.5 秒）。
     *
     * 「允许」只在 auto-jump 上下文（含「想要打开」/「是否允许」）才点——否则见到任何
     * 应用的权限框里的「允许」都乱点，是危险行为。
     */
    fun pickDismissLabel(allTexts: List<String>): String? {
        val isAutoJump = allTexts.any { it.contains("想要打开") || it.contains("是否允许") }
        if (isAutoJump && allTexts.any { it.trim() == "允许" }) return "允许"
        return DISMISS_LABELS.firstOrNull { label -> allTexts.any { it.trim() == label } }
    }

    private val DISMISS_LABELS = listOf("跳过", "关闭", "稍后", "取消", "我知道了")

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
 *
 * ⚠️ **[finder] 必须廉价**：它每一轮都会执行一次。优先用
 * `root.findAccessibilityNodeInfosByViewId(...)`（系统索引查询）；避免在 finder 里做全树 BFS
 * ——`AccessibilityNodeInfo.getChild()` 每次都是跨进程 binder 调用，在 Lynx 渲染的巨树
 * （如抖音 SearchResultActivity）上单次遍历就要几十秒，乘以轮询次数会把整条协程拖死。
 * 2026-08-18 真机实测踩过：finder 里带了一个无界 `findFirstEditText`，协程两分钟无进展。
 * 昂贵的兜底查找放到轮询【之后】只做一次。
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

// ── 前台闸：等目标 App 真的铺到前台，期间主动消除厂商插屏 ────────────────────
// 这是「两层等待」的第一层。第二层是上面的 awaitNode（等目标节点就绪）。
// 二者缺一不可：只有第二层时，厂商开屏广告盖着抖音会让节点永远等不到（真机实证）；
// 只有第一层时，抖音自己还在加载也会让后续查找扑空。

/** 收集整棵树上的 text 与 content-desc 文案（供 [NodeAwait.pickDismissLabel] 判断）。 */
private fun collectAllTexts(root: AccessibilityNodeInfo): List<String> {
    val out = mutableListOf<String>()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var visited = 0
    while (queue.isNotEmpty() && visited < 2_000) {
        val node = queue.removeFirst()
        visited++
        node.text?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
        for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
    }
    return out
}

/** 按精确文案或 content-desc 找节点。 */
private fun findByLabel(root: AccessibilityNodeInfo, label: String): AccessibilityNodeInfo? {
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var visited = 0
    while (queue.isNotEmpty() && visited < 2_000) {
        val node = queue.removeFirst()
        visited++
        if (node.text?.toString()?.trim() == label || node.contentDescription?.toString()?.trim() == label) return node
        for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
    }
    return null
}

/**
 * 手势点击节点中心。
 *
 * **必须用手势，不能用 performAction(ACTION_CLICK)**：真机复现（2026-07-29，ANY-AN00）证实
 * 该 App 生态里 ACTION_CLICK 对部分节点无效——点厂商壁纸推荐弹窗的「关闭」毫无反应，弹窗卡到
 * 超时，最终报 OPEN_PANEL_FAILED。见 DeviceAccountScanServiceVendorPopupDismissTest。
 */
private fun AccessibilityService.tapNodeCenterByGesture(node: AccessibilityNodeInfo) {
    val r = Rect()
    node.getBoundsInScreen(r)
    if (r.isEmpty) return
    val path = Path().apply { moveTo(r.exactCenterX(), r.exactCenterY()) }
    val gesture = GestureDescription.Builder()
        .addStroke(GestureDescription.StrokeDescription(path, 0L, 60L))
        .build()
    dispatchGesture(gesture, null, null)
}

/**
 * 等 [pkg] 真的成为前台包；期间若前台是别的应用（厂商开屏广告/系统提示），
 * 先尝试点「跳过/关闭/…」消除，找不到可消除项则按返回键。
 *
 * **只在前台不是目标包时按返回**，绝不在目标 App 内部误退。
 * 移植自 DouyinDmOutreachService.awaitDouyinForeground（那是 dm 侧已验证过的实现），
 * 提到共享设施供 collect / account-scan 一并使用。
 *
 * @return 最终前台是否为 [pkg]（尽力而为，超时也返回当前事实而不抛异常）
 */
suspend fun AccessibilityService.awaitAppForeground(
    pkg: String,
    maxAttempts: Int = 24,
    intervalMs: Long = 500L,
): Boolean {
    repeat(maxAttempts) {
        val root = rootInActiveWindow
        val current = root?.packageName?.toString()
        if (current == pkg) return true
        if (root != null && current != null) {
            val label = NodeAwait.pickDismissLabel(collectAllTexts(root))
            val target = label?.let { findByLabel(root, it) }
            if (target != null) {
                tapNodeCenterByGesture(target)
                android.util.Log.i("NodeAwait", "awaitAppForeground: 前台=$current 手势点掉「$label」")
            } else {
                performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                android.util.Log.i("NodeAwait", "awaitAppForeground: 前台=$current 无可消除项，按返回")
            }
        }
        delay(intervalMs)
    }
    return rootInActiveWindow?.packageName?.toString() == pkg
}
