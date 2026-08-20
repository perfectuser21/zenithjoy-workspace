package com.zenithjoy.agent.onboarding

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.view.accessibility.AccessibilityManager

/**
 * 系统**真正绑定(Bound)**的一个无障碍服务。
 * packageName / className 直接取自 `ResolveInfo.serviceInfo`，是系统给出的规范值，
 * 不存在 `pkg/.Short` 与 `pkg/full.Class` 两种写法的格式歧义。
 */
data class BoundAccessibilityService(val packageName: String, val className: String)

/**
 * 本进程无障碍自检结果。
 * @param missing          本包名下没有绑上的必需服务（全限定类名）
 * @param foreignHolders   缺失服务类名 → **别的包名**持有它。这一项是排查的关键：
 *                         真机上出现过「授权全落在 .e2e 变体包、干活的 prod 包一条没有」，
 *                         不点名是谁拿走了，排查一次要烧一整天。
 */
data class AccessibilitySelfCheck(
    val missing: List<String>,
    val foreignHolders: Map<String, List<String>>,
) {
    val allBound: Boolean get() = missing.isEmpty()

    /** 一行人话诊断，直接进 logcat / 状态页。 */
    fun describe(): String = when {
        allBound -> "无障碍 ✅ 三个服务均已绑定到本进程"
        foreignHolders.isEmpty() -> "无障碍 ❌ 未绑定: ${missing.joinToString()}"
        else -> "无障碍 ❌ 未绑定: ${missing.joinToString()}；" +
            "注意——这些服务的授权被其它包名持有: " +
            foreignHolders.entries.joinToString { "${it.key.substringAfterLast('.')} → ${it.value.joinToString("/")}" } +
            "（同一个 App 的不同变体包各自独立授权，授给了哪个包只有那个包能用）"
    }
}

/** 三个必需无障碍服务的**类名**（不含包名——包名必须用运行时的 context.packageName，变体包不同）。 */
val REQUIRED_ACCESSIBILITY_SERVICE_CLASSES = listOf(
    "com.zenithjoy.agent.collect.DouyinCollectService",
    "com.zenithjoy.agent.collect.DouyinDmOutreachService",
    "com.zenithjoy.agent.account.DeviceAccountScanService",
)

/**
 * 纯函数：判定本进程需要的无障碍服务有没有真的绑上，以及缺的那些被谁拿走了。
 *
 * 判据故意做成"包名必须严格相等"——`com.zenithjoy.agent` 与 `com.zenithjoy.agent.e2e`
 * 是两个独立的 App，授权互不相通，前缀相同不代表是自己。
 */
fun checkSelfAccessibility(
    bound: List<BoundAccessibilityService>,
    selfPackage: String,
    requiredClasses: List<String> = REQUIRED_ACCESSIBILITY_SERVICE_CLASSES,
): AccessibilitySelfCheck {
    val mine = bound.filter { it.packageName == selfPackage }.map { it.className }.toSet()
    val missing = requiredClasses.filterNot { it in mine }

    val foreignHolders = LinkedHashMap<String, List<String>>()
    for (cls in missing) {
        val holders = bound.filter { it.className == cls && it.packageName != selfPackage }
            .map { it.packageName }
            .distinct()
            .sorted()
        if (holders.isNotEmpty()) foreignHolders[cls] = holders
    }
    return AccessibilitySelfCheck(missing, foreignHolders)
}

/**
 * 取系统**真正绑定**的无障碍服务列表。
 *
 * 用 `AccessibilityManager.getEnabledAccessibilityServiceList()` 而**不是**读
 * `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 字符串：后者是"用户勾过什么"的记录，
 * ColorOS 等 ROM 上会出现「字符串里有、系统压根没 bind」的假成功（Enabled ≠ Bound，
 * 真机实测 `dumpsys accessibility` 的 Bound services 才是真的）。
 * 前者返回的是 AccessibilityManagerService 当前实际持有的服务，读得到即绑定成功。
 */
fun boundAccessibilityServices(context: Context): List<BoundAccessibilityService> {
    val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        ?: return emptyList()
    return runCatching {
        manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .orEmpty()
            .mapNotNull { info ->
                val serviceInfo = info.resolveInfo?.serviceInfo ?: return@mapNotNull null
                BoundAccessibilityService(serviceInfo.packageName, serviceInfo.name)
            }
    }.getOrDefault(emptyList())
}

/** 运行时自检：本进程的三个无障碍服务绑上了没有。 */
fun checkSelfAccessibility(context: Context): AccessibilitySelfCheck =
    checkSelfAccessibility(boundAccessibilityServices(context), context.packageName)
