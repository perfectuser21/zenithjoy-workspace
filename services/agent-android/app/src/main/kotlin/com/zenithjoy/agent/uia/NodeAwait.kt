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

/** 前台闸一轮的动作。 */
enum class GateAction { DONE, TAP_DISMISS, PRESS_BACK, WAIT }

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
     * 前台闸每一轮该做什么。纯决策，便于单测覆盖那些「按错一次就毁掉整条链路」的分支。
     *
     * 真机复现（2026-08-18，小黄 MAA-AN00）：初版逻辑是「前台不是目标包就按返回」，结果把
     * **自家正在转发的 trampoline Activity** 按掉了，一路退到桌面，抖音永远起不来。
     * 小粉那次「成功」只是因为恰好弹了厂商授权框（前台是 systemmanager），掩盖了这个缺陷。
     *
     * 判定顺序（顺序本身就是语义，别随手调换）：
     * 1. 已经是目标包 → 完成
     * 2. 有可消除项 → 点掉（即使当前前台是自家包，也可能是系统框盖在自家页面上）
     * 3. 前台是自己 → **等**，绝不按返回（trampoline 正在把目标 App 拉起来）
     * 4. 前台是桌面 → **等**，按返回退不出桌面，纯属浪费轮次
     * 5. 前台是别的 App → 按返回
     * 6. 连窗口都取不到 → 等够 [BLIND_ROUNDS_BEFORE_BACK] 轮再按返回
     */
    fun decideGateAction(
        currentPkg: String?,
        selfPkg: String,
        targetPkg: String,
        hasDismissTarget: Boolean,
        blindRounds: Int,
    ): GateAction = when {
        currentPkg == targetPkg -> GateAction.DONE
        hasDismissTarget -> GateAction.TAP_DISMISS
        currentPkg == selfPkg -> GateAction.WAIT
        currentPkg != null && isLauncherPkg(currentPkg) -> GateAction.WAIT
        currentPkg != null -> GateAction.PRESS_BACK
        blindRounds >= BLIND_ROUNDS_BEFORE_BACK -> GateAction.PRESS_BACK
        else -> GateAction.WAIT
    }

    /** 连续多少轮取不到任何窗口树后才按返回（避免目标 App 内部瞬时取不到树时误退）。 */
    const val BLIND_ROUNDS_BEFORE_BACK = 4

    /** 桌面/启动器包名判定：各厂商命名不一（launcher / .home / homescreen）。 */
    fun isLauncherPkg(pkg: String): Boolean =
        pkg.contains("launcher", ignoreCase = true) ||
            pkg.endsWith(".home") ||
            pkg.contains("homescreen", ignoreCase = true)

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

/**
 * 用系统索引查询（[AccessibilityNodeInfo.findAccessibilityNodeInfosByText]）探出页面上存在哪些
 * 关心的文案，**不做全树遍历**。
 *
 * 2026-08-18 真机踩过：初版这里用全树 BFS 收集所有文案，而前台闸每轮都要跑一次——厂商插屏页的树
 * 上每个 getChild() 都是跨进程 binder 调用，account-scan 冷启动实测 144 秒毫无进展。这与本文件
 * 给 awaitNode 定的「finder 必须廉价」是同一条规矩，前台闸自己也必须守。
 *
 * 系统索引是**模糊匹配**（contains），所以命中后仍要精确校验，避免「是否允许」把「允许」也算进来。
 */
/**
 * 一轮只扫一次：返回 (该点的标签, 对应节点)。
 *
 * 2026-08-18 真机踩过两次「每轮重复扫描」的代价，第二次尤其惨：初版 probeLabels 里对 8 个候选
 * 标签各调一次 findLabelAcrossWindows，而后者每次都重新 rootsToSearch()（含 windows 遍历），
 * 于是每轮实际扫了 8 遍所有窗口——真机日志显示**一轮耗时 67 秒**（设计值 500ms），24 轮要 27 分钟。
 * 现在每轮只取一次 roots、只走一遍候选表，命中即记下节点，避免二次查找。
 */
private fun AccessibilityService.scanForDismiss(): Pair<String?, AccessibilityNodeInfo?> {
    val roots = rootsToSearch()
    if (roots.isEmpty()) return null to null
    val found = mutableListOf<String>()
    for (marker in AUTO_JUMP_MARKERS) {
        if (roots.any { it.findAccessibilityNodeInfosByText(marker)?.isNotEmpty() == true }) found.add(marker)
    }
    val hits = HashMap<String, AccessibilityNodeInfo>()
    for (label in CANDIDATE_LABELS) {
        for (r in roots) {
            val n = findByLabel(r, label)
            if (n != null) { hits[label] = n; found.add(label); break }
        }
    }
    val label = NodeAwait.pickDismissLabel(found)
    return label to label?.let { hits[it] }
}

/**
 * 要搜的窗口根节点集合：活动窗口 + 所有可交互窗口。
 *
 * **必须跨窗口**：真机截图实证（2026-08-18 荣耀 X30）——系统的 auto-jump 授权框
 * 「"ZenithJoyAgent" 想要打开 "抖音"，是否允许？」盖在桌面上时，`rootInActiveWindow`
 * 返回 null（该对话框在独立 window 里，不是 activeWindow），前台闸因此一轮都没进消除分支、
 * 连日志都打不出来，只能干等到超时报 OPEN_PANEL_FAILED。
 * 依赖服务配置里的 `flagRetrieveInteractiveWindows`（三个 service 的 xml 均已开）。
 */
private fun AccessibilityService.rootsToSearch(): List<AccessibilityNodeInfo> {
    val out = mutableListOf<AccessibilityNodeInfo>()
    rootInActiveWindow?.let { out.add(it) }
    // 上限保护：窗口列表异常膨胀时不让扫描代价失控（每个 root 上的查询都是跨进程调用）
    windows?.take(MAX_WINDOWS_TO_SCAN)?.forEach { w -> w.root?.let { if (out.none { o -> o == it }) out.add(it) } }
    return out.take(MAX_WINDOWS_TO_SCAN)
}

private val AUTO_JUMP_MARKERS = listOf("想要打开", "是否允许")
private const val MAX_WINDOWS_TO_SCAN = 6
private val CANDIDATE_LABELS = listOf("允许", "跳过", "关闭", "稍后", "取消", "我知道了")

/**
 * 按精确文案或 content-desc 找节点：先用系统索引缩小候选（模糊匹配），再精确校验。
 * 全程不做全树遍历。
 */
private fun findByLabel(root: AccessibilityNodeInfo, label: String): AccessibilityNodeInfo? =
    root.findAccessibilityNodeInfosByText(label)?.firstOrNull { n ->
        n.text?.toString()?.trim() == label || n.contentDescription?.toString()?.trim() == label
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
    var blindRounds = 0
    repeat(maxAttempts) {
        val current = rootInActiveWindow?.packageName?.toString()
        // 跨窗口找可消除项：系统对话框常不在 activeWindow 里（真机实证 rootInActiveWindow 为 null）
        val (label, target) = scanForDismiss()
        when (NodeAwait.decideGateAction(current, packageName, pkg, target != null, blindRounds)) {
            GateAction.DONE -> return true
            GateAction.TAP_DISMISS -> {
                tapNodeCenterByGesture(target!!)
                blindRounds = 0
                android.util.Log.i("NodeAwait", "awaitAppForeground: 前台=$current 手势点掉「$label」")
            }
            GateAction.PRESS_BACK -> {
                performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                blindRounds = 0
                android.util.Log.i("NodeAwait", "awaitAppForeground: 前台=$current 无可消除项，按返回")
            }
            GateAction.WAIT -> {
                if (current == null) blindRounds++
                android.util.Log.i("NodeAwait", "awaitAppForeground: 前台=${current ?: "无窗口"} 等待（不按返回）")
            }
        }
        delay(intervalMs)
    }
    return rootInActiveWindow?.packageName?.toString() == pkg
}
