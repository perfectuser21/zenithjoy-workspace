package com.zenithjoy.agent.onboarding

import android.content.Context
import android.content.pm.PackageManager

/**
 * 同族变体包互斥闸。
 *
 * 同族变体 = 同一份代码用 `applicationIdSuffix` 打出来的不同 App（`app/build.gradle.kts`
 * 的 buildTypes 里声明）。它们在系统里是**两个独立 App，无障碍授权互不相通**，
 * 但 label 都叫「ZenithJoy Agent」——客户在系统无障碍列表里看到两个同名条目，点错一个
 * 就静默失效。
 *
 * 真机对照实验(2026-08-20)：
 * | 机器 | 无障碍授权归属 | 能否干活 |
 * |---|---|---|
 * | 小黄 MAA-AN00 | com.zenithjoy.agent × 3（prod） | ✅ |
 * | 小白 RMX3478 | com.zenithjoy.agent.e2e × 3（变体） | ❌ 派发广播进虚空 |
 *
 * 唯一变量是授权点在哪个包上，**与手机品牌无关**。BYOD 客户场景下这是 100% 可根除的
 * 自造坑：开发变体本就不该出现在客户机上。
 */

/** 打包配置里声明过的全部变体后缀（与 app/build.gradle.kts 的 applicationIdSuffix 对齐）。 */
val KNOWN_VARIANT_SUFFIXES = listOf(".e2e")

/**
 * 由本进程包名推导出所有同族变体包名（不含自己）。
 * `com.zenithjoy.agent` → `[com.zenithjoy.agent.e2e]`；
 * `com.zenithjoy.agent.e2e` → `[com.zenithjoy.agent]`。
 *
 * 故意从**运行时** `context.packageName` 推，不硬编码任何包名——硬编码包名正是
 * 上一版自检踩过的坑（e2e 变体里跑时永远判错，见 SelfPackageAccessibilityTest）。
 */
fun siblingVariantPackages(selfPackage: String): List<String> {
    val base = KNOWN_VARIANT_SUFFIXES
        .firstOrNull { selfPackage.endsWith(it) }
        ?.let { selfPackage.removeSuffix(it) }
        ?: selfPackage
    return (listOf(base) + KNOWN_VARIANT_SUFFIXES.map { base + it })
        .distinct()
        .filter { it != selfPackage }
}

enum class VariantVerdict {
    /** 干净：没有同族变体包。 */
    OK,

    /** 有隐患但还能干活：提示 + 给卸载入口，**不阻断**。 */
    WARN,

    /** 已经坏了：本进程需要的无障碍服务被同族变体包拿走了，必须拦下来让客户处置。 */
    BLOCK,
    ;

    fun blocksUsage(): Boolean = this == BLOCK
}

/**
 * @param siblingPackages   实际装在机器上的同族变体包
 * @param hijackedServices  我们的服务类名 → 拿走它的同族包（只统计同族包，第三方 app 不算）
 */
data class VariantConflict(
    val verdict: VariantVerdict,
    val siblingPackages: List<String>,
    val hijackedServices: Map<String, List<String>>,
) {
    fun describe(): String = when (verdict) {
        VariantVerdict.OK -> "未发现同族变体包"
        VariantVerdict.WARN ->
            "检测到同族变体包 ${siblingPackages.joinToString()} 也装在这台机器上。" +
                "两个同名 App 会互相抢抖音，且无障碍授权容易点错包，建议卸载后再用。"
        VariantVerdict.BLOCK ->
            "无障碍授权点到了错的 App 上：" +
                hijackedServices.entries.joinToString("；") {
                    "${it.key.substringAfterLast('.')} 的授权在 ${it.value.joinToString("/")} 手里"
                } +
                "。这台机器上装了同族变体包 ${siblingPackages.joinToString()}，" +
                "它和本 App 是两个独立应用、授权互不相通。卸载它再重新授权即可。"
    }
}

/**
 * 分级判定。**分级是硬要求**：小黄同样双包并存却工作正常，一刀切 BLOCK 会把产出最好的
 * 机器当场拦停。
 *
 * - 无同族包 → OK
 * - 有同族包 + 本包三服务全绑 → WARN（小黄）
 * - 有同族包 + 缺的服务正被同族包持有 → BLOCK（小白）
 * - 有同族包 + 缺服务但不是被同族包拿走 → WARN（缺服务归无障碍横幅管，不重复报）
 */
fun judgeVariantConflict(
    installedSiblings: List<String>,
    selfCheck: AccessibilitySelfCheck,
): VariantConflict {
    if (installedSiblings.isEmpty()) {
        return VariantConflict(VariantVerdict.OK, emptyList(), emptyMap())
    }

    val hijacked = LinkedHashMap<String, List<String>>()
    for ((serviceClass, holders) in selfCheck.foreignHolders) {
        val siblingHolders = holders.filter { it in installedSiblings }
        if (siblingHolders.isNotEmpty()) hijacked[serviceClass] = siblingHolders
    }

    val verdict = if (hijacked.isNotEmpty()) VariantVerdict.BLOCK else VariantVerdict.WARN
    return VariantConflict(verdict, installedSiblings, hijacked)
}

/**
 * 查这台机器上实际装着哪些同族变体包。
 *
 * ⚠️ 安卓 11+ 包可见性：targetSdk 30+ 查别的包必须在 AndroidManifest 里声明 `<queries>`，
 * 否则是**"合法失败"**（抛 NameNotFoundException / 返回 null）而不是报错，极易误判成
 * "没装"。manifest 里已按此声明两个变体包名。
 */
fun installedSiblingVariants(context: Context): List<String> =
    siblingVariantPackages(context.packageName).filter { pkg ->
        runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess
    }

/** 运行时一站式判定。 */
fun checkVariantConflict(context: Context): VariantConflict =
    judgeVariantConflict(installedSiblingVariants(context), checkSelfAccessibility(context))
