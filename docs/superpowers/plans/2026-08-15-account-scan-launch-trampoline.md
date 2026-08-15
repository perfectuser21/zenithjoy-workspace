# 账号扫描 LAUNCH_BLOCKED 透明 trampoline 修复 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `DeviceAccountScanService` 拉起抖音前先经自家透明 trampoline Activity 成为前台 Activity，绕过荣耀 iAware 等厂商"后台调用方不许拉起第三方 App"的拦截；trampoline 起不来时退回原直启，行为零退化。

**Architecture:** 新增 `DouyinLaunchTrampoline`（常量+纯函数+Intent 构造）与 `DouyinLaunchTrampolineActivity`（透明、noHistory、excludeFromRecents、singleTask；onResume 起目标后 finish；2s 自杀）；`launchDouyinApp()` 改为 trampoline 优先、直启回退。所有 5 处调用点不动。

**Tech Stack:** Kotlin / Android (minSdk 26, targetSdk 34) / JUnit4 JVM 单测（本 repo 单测**不能**构造 `android.content.Intent`，Intent 只在 Activity/Service 里构造；守卫用常量断言 + 源文本断言，对齐既有 `ManifestForegroundServiceTypeTest` / `MainActivityRegisterErrorDisplayTest`）。

**Spec:** `docs/superpowers/specs/2026-08-15-account-scan-launch-trampoline-design.md`；Brain task `29320ff1`；worktree `/Users/administrator/worktrees/zenithjoy/account-scan-launch-trampoline`，分支 `cp-0815204943-account-scan-launch-trampoline`。

**所有命令的 cwd：** `/Users/administrator/worktrees/zenithjoy/account-scan-launch-trampoline/services/agent-android`。单测命令：`./gradlew :app:testDebugUnitTest --tests '<FQCN>' -q --console=plain 2>&1 | grep -v "SDK processing"`。

---

## 文件结构

- Create `app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampoline.kt` — 常量、`resolveTargetPackage`、`buildTrampolineIntent`
- Create `app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt` — 透明 trampoline Activity
- Modify `app/src/main/AndroidManifest.xml` — 声明 activity（放在 `ShareIngestActivity` 之后）
- Modify `app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt` — `DOUYIN_PKG` 改 internal；`launchDouyinApp()` 改 trampoline 优先 + `launchDouyinDirect()` 回退
- Modify `app/build.gradle.kts:14-15` — versionCode 25 / versionName 2.1.21
- Test `app/src/test/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineTest.kt`
- Test `app/src/test/kotlin/com/zenithjoy/agent/ManifestLaunchTrampolineActivityTest.kt`
- Test `app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceLaunchTrampolineTest.kt`

---

### Task 1: 纯逻辑守卫 + `DouyinLaunchTrampoline` object

**Files:**
- Test: `app/src/test/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineTest.kt`
- Create: `app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampoline.kt`
- Modify: `app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt:894`（`private const val DOUYIN_PKG` → `internal const val DOUYIN_PKG`）

- [x] **Step 1: 写失败测试**

```kotlin
package com.zenithjoy.agent.account

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1，decision 61298fc6）。
 * 荣耀 iAware 拒绝无障碍服务从后台直接拉起抖音；修法是先起自家透明 trampoline Activity。
 * 本测试锁定 trampoline 的纯逻辑：目标包名解析 + 两组 Intent flags 与原直启一致。
 */
class DouyinLaunchTrampolineTest {

    @Test
    fun `空或空白 extra 退回默认抖音包`() {
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage(null))
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage(""))
        assertEquals("com.ss.android.ugc.aweme", DouyinLaunchTrampoline.resolveTargetPackage("   "))
    }

    @Test
    fun `显式包名去空白后原样返回`() {
        assertEquals("com.example.other", DouyinLaunchTrampoline.resolveTargetPackage(" com.example.other "))
    }

    @Test
    fun `默认目标包与 DeviceAccountScanService 的 DOUYIN_PKG 是同一常量`() {
        assertEquals(DeviceAccountScanService.DOUYIN_PKG, DouyinLaunchTrampoline.DEFAULT_TARGET_PACKAGE)
    }

    @Test
    fun `目标启动 flags 含 NEW_TASK 与 CLEAR_TOP（与原直启一致）`() {
        assertTrue(DouyinLaunchTrampoline.TARGET_FLAGS and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(DouyinLaunchTrampoline.TARGET_FLAGS and Intent.FLAG_ACTIVITY_CLEAR_TOP != 0)
    }

    @Test
    fun `trampoline 自身 flags 含 NEW_TASK（从 Service 上下文启动所需）`() {
        assertTrue(DouyinLaunchTrampoline.TRAMPOLINE_FLAGS and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }
}
```

- [x] **Step 2: 跑测试确认编译失败（红）**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.account.DouyinLaunchTrampolineTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -20`
Expected: 编译错误 `Unresolved reference: DouyinLaunchTrampoline`（以及 `DOUYIN_PKG` 不可见）。

- [x] **Step 3: commit-1（先红）**

```bash
git add app/src/test/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineTest.kt
git commit -m "test(agent-android): DouyinLaunchTrampoline 纯逻辑守卫（先红）[29320ff1]"
```

- [x] **Step 4: 最小实现**

`app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampoline.kt`：

```kotlin
package com.zenithjoy.agent.account

import android.content.Context
import android.content.Intent

/**
 * 账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1，decisions 964ba941/61298fc6/7ea333a3）。
 *
 * 真机实证（4号机 MAA-AN00 荣耀 Android 15，同机同包对照）：无障碍服务从后台直接
 * startActivity 拉抖音被荣耀 iAware 拒绝（logcat `prevent start activity by iaware`，
 * result 102）0/5；1px 无障碍 overlay 0/3（AOSP 判可见窗口放行、iAware 仍拦——它认的是
 * "调用方有前台 Activity"）；先 startActivity 自家 Activity 再拉抖音 3/3。
 *
 * 所以拉抖音改为两跳：Service → [DouyinLaunchTrampolineActivity]（透明、无 UI、不进最近
 * 任务）→ 目标 App。本 object 只放常量与纯逻辑；Intent 构造只由 Activity/Service 调用
 * （本 repo JVM 单测不能构造 android Intent，见 DouyinLaunchTrampolineTest）。
 */
object DouyinLaunchTrampoline {
    const val EXTRA_TARGET_PACKAGE = "com.zenithjoy.agent.extra.LAUNCH_TARGET_PACKAGE"

    /** 与 DeviceAccountScanService.DOUYIN_PKG 是同一常量，不留两份字面量。 */
    const val DEFAULT_TARGET_PACKAGE = DeviceAccountScanService.DOUYIN_PKG

    /** trampoline 自身从 Service 上下文启动，必须 NEW_TASK。 */
    const val TRAMPOLINE_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK

    /** 目标 App 的启动 flags，与改动前 launchDouyinApp() 直启完全一致。 */
    const val TARGET_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP

    fun resolveTargetPackage(extra: String?): String =
        extra?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_TARGET_PACKAGE

    fun buildTrampolineIntent(context: Context, targetPackage: String): Intent =
        Intent(context, DouyinLaunchTrampolineActivity::class.java)
            .addFlags(TRAMPOLINE_FLAGS)
            .putExtra(EXTRA_TARGET_PACKAGE, targetPackage)
}
```

同时把 `DeviceAccountScanService.kt:894` 的 `private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"` 改为 `internal const val DOUYIN_PKG = "com.ss.android.ugc.aweme"`。

> 注意：`buildTrampolineIntent` 引用了 Task 2 才创建的 `DouyinLaunchTrampolineActivity`。为了让本 Task 独立可编译，Task 1 里先创建一个最小占位 Activity 文件（Task 2 会用完整实现覆盖）：

`app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt`（Task 1 占位版）：

```kotlin
package com.zenithjoy.agent.account

import android.app.Activity

/** 占位：完整实现见 Task 2。 */
class DouyinLaunchTrampolineActivity : Activity()
```

- [x] **Step 5: 跑测试确认绿**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.account.DouyinLaunchTrampolineTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -20`
Expected: 无输出（全部 PASS）。

- [x] **Step 6: commit-2**

```bash
git add app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampoline.kt \
        app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt \
        app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "feat(agent-android): DouyinLaunchTrampoline 常量与目标包解析 [29320ff1]"
```

---

### Task 2: Manifest 守卫 + 完整 `DouyinLaunchTrampolineActivity`

**Files:**
- Test: `app/src/test/kotlin/com/zenithjoy/agent/ManifestLaunchTrampolineActivityTest.kt`
- Modify: `app/src/main/AndroidManifest.xml`（`ShareIngestActivity` 的 `</activity>` 之后）
- Modify: `app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt`（覆盖 Task 1 占位版）

- [x] **Step 1: 写失败测试**

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1）依赖一个透明 trampoline Activity。
 * 若它从 Manifest 消失或属性被改坏（进最近任务/留返回栈/带 UI/被导出），客户手机上会出现
 * 残留窗口或安全面暴露——本测试锁定声明形态，对齐既有 ShareIngestActivity 模式。
 */
class ManifestLaunchTrampolineActivityTest {

    private fun manifestText(): String {
        val file = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        ).firstOrNull { it.exists() } ?: error("AndroidManifest.xml not found")
        return file.readText()
    }

    /** 提取 trampoline activity 的整段声明（自闭合或带子节点均可）。 */
    private fun trampolineDeclaration(manifest: String): String {
        val regex = Regex(
            "<activity[^>]*android:name=\"\\.account\\.DouyinLaunchTrampolineActivity\"[^>]*?(/>|>)",
            RegexOption.DOT_MATCHES_ALL,
        )
        return regex.find(manifest)?.value
            ?: error("Manifest 未声明 .account.DouyinLaunchTrampolineActivity")
    }

    private fun attr(decl: String, name: String): String? =
        Regex("android:$name=\"([^\"]*)\"").find(decl)?.groupValues?.get(1)

    @Test
    fun `trampoline activity 已声明且不导出`() {
        val decl = trampolineDeclaration(manifestText())
        assertEquals("false", attr(decl, "exported"))
    }

    @Test
    fun `trampoline activity 不进最近任务、不留返回栈、独立 task、透明主题`() {
        val decl = trampolineDeclaration(manifestText())
        assertEquals("true", attr(decl, "excludeFromRecents"))
        assertEquals("true", attr(decl, "noHistory"))
        assertEquals("", attr(decl, "taskAffinity"))
        assertEquals("singleTask", attr(decl, "launchMode"))
        assertTrue(
            "theme 必须是透明主题",
            (attr(decl, "theme") ?: "").contains("Translucent"),
        )
    }
}
```

- [x] **Step 2: 跑测试确认红**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.ManifestLaunchTrampolineActivityTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -20`
Expected: FAIL，`Manifest 未声明 .account.DouyinLaunchTrampolineActivity`。

- [x] **Step 3: commit-1（先红）**

```bash
git add app/src/test/kotlin/com/zenithjoy/agent/ManifestLaunchTrampolineActivityTest.kt
git commit -m "test(agent-android): Manifest 必须声明透明 trampoline activity（先红）[29320ff1]"
```

- [x] **Step 4: 实现 — Manifest 声明**

在 `app/src/main/AndroidManifest.xml` 里 `ShareIngestActivity` 的 `</activity>`（约第 60 行）之后插入：

```xml
        <!-- 账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1，decision 61298fc6）：荣耀 iAware
             拒绝无障碍服务从后台直接拉起抖音；先起这个透明、无 UI、不进最近任务的 trampoline
             让 App 成为前台 Activity，由它在 onResume 拉起目标 App 后立即 finish。 -->
        <activity
            android:name=".account.DouyinLaunchTrampolineActivity"
            android:exported="false"
            android:launchMode="singleTask"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.Translucent.NoTitleBar" />
```

- [x] **Step 5: 实现 — 完整 Activity（覆盖 Task 1 占位版）**

`app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt`：

```kotlin
package com.zenithjoy.agent.account

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * 透明 trampoline：让 App 先成为前台 Activity，再从前台拉起目标 App（默认抖音），随后立即 finish。
 *
 * 为什么需要它：荣耀 iAware 等厂商策略拒绝"没有前台 Activity 的调用方"拉起第三方 App
 * （4号机真机 0/5，`prevent start activity by iaware`），而调用方自己的 Activity 放行、
 * 从该 Activity 再拉目标则 `BAL_ALLOW_VISIBLE_WINDOW` 放行（3/3）。见 [DouyinLaunchTrampoline]。
 *
 * 形态对齐 ShareIngestActivity：Manifest 上 Translucent 主题 + noHistory + excludeFromRecents +
 * taskAffinity="" + singleTask；代码上有自杀定时器兜底（焦点始终不来也不泄漏），
 * singleTask 复用（onNewIntent）时先清旧定时器再重挂，避免带着上一轮的过期回调。
 */
class DouyinLaunchTrampolineActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var launched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        armSelfKill()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        launched = false
        armSelfKill()
    }

    override fun onResume() {
        super.onResume()
        if (launched) return
        launched = true
        launchTargetThenFinish()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun armSelfKill() {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (!isFinishing) finish() }, SELF_KILL_MS)
    }

    private fun launchTargetThenFinish() {
        val target = DouyinLaunchTrampoline.resolveTargetPackage(
            intent?.getStringExtra(DouyinLaunchTrampoline.EXTRA_TARGET_PACKAGE),
        )
        try {
            val launch = packageManager.getLaunchIntentForPackage(target)
            if (launch == null) {
                android.util.Log.w(TAG, "目标未安装，无法拉起: $target")
            } else {
                launch.addFlags(DouyinLaunchTrampoline.TARGET_FLAGS)
                startActivity(launch)
                android.util.Log.i(TAG, "已从前台 trampoline 拉起 $target")
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "trampoline 拉起 $target 失败: ${e.message}")
        }
        finish()
    }

    companion object {
        private const val TAG = "DouyinLaunchTrampoline"
        const val SELF_KILL_MS = 2_000L
    }
}
```

- [x] **Step 6: 跑测试确认绿（同时确认 Task 1 仍绿、整体编译通过）**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.ManifestLaunchTrampolineActivityTest' --tests 'com.zenithjoy.agent.account.DouyinLaunchTrampolineTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -20`
Expected: 无输出（PASS）。

- [x] **Step 7: commit-2**

```bash
git add app/src/main/AndroidManifest.xml app/src/main/kotlin/com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt
git commit -m "feat(agent-android): 透明 DouyinLaunchTrampolineActivity + Manifest 声明 [29320ff1]"
```

---

### Task 3: 服务接线守卫 + `launchDouyinApp()` 改 trampoline 优先、直启回退

**Files:**
- Test: `app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceLaunchTrampolineTest.kt`
- Modify: `app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt:449-458`

- [x] **Step 1: 写失败测试**

```kotlin
package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：账号扫描 LAUNCH_BLOCKED 修复（Brain task 29320ff1）的接线不能被静默拆掉。
 * 本 repo JVM 单测无法运行 AccessibilityService/Activity，只能锁源文本
 * （对齐 MainActivityRegisterErrorDisplayTest 的做法）：
 *  1) DeviceAccountScanService.launchDouyinApp() 必须经 DouyinLaunchTrampoline.buildTrampolineIntent 起 trampoline；
 *  2) 必须保留直启回退 launchDouyinDirect()（trampoline 起不来时行为 = 改动前）；
 *  3) trampoline Activity 必须在 onResume 拉起目标并 finish。
 */
class DeviceAccountScanServiceLaunchTrampolineTest {

    private fun source(relative: String): String {
        val file = listOf("src/main/kotlin/$relative", "app/src/main/kotlin/$relative")
            .map { File(it) }.firstOrNull { it.exists() } ?: error("$relative not found")
        return file.readText()
    }

    private fun functionBody(src: String, signature: String): String {
        val start = src.indexOf(signature).also { require(it >= 0) { "找不到 $signature" } }
        // 取到下一个顶层 "    private fun " / "    override fun " / "    fun " 之前
        val rest = src.substring(start + signature.length)
        val next = Regex("\\n    (private |internal |override )?(suspend )?fun ").find(rest)?.range?.first ?: rest.length
        return rest.substring(0, next)
    }

    @Test
    fun `launchDouyinApp 经 trampoline 拉起并保留直启回退`() {
        val svc = source("com/zenithjoy/agent/account/DeviceAccountScanService.kt")
        val body = functionBody(svc, "private fun launchDouyinApp()")
        assertTrue("launchDouyinApp 必须调用 DouyinLaunchTrampoline.buildTrampolineIntent", body.contains("DouyinLaunchTrampoline.buildTrampolineIntent"))
        assertTrue("launchDouyinApp 必须在异常时回退 launchDouyinDirect()", body.contains("launchDouyinDirect()"))
        val direct = functionBody(svc, "private fun launchDouyinDirect()")
        assertTrue("launchDouyinDirect 必须保留原 getLaunchIntentForPackage 直启", direct.contains("getLaunchIntentForPackage(DOUYIN_PKG)"))
    }

    @Test
    fun `trampoline activity 在 onResume 拉起目标并 finish`() {
        val act = source("com/zenithjoy/agent/account/DouyinLaunchTrampolineActivity.kt")
        assertTrue(act.contains("override fun onResume()"))
        assertTrue(act.contains("getLaunchIntentForPackage("))
        assertTrue(act.contains("DouyinLaunchTrampoline.TARGET_FLAGS"))
        assertTrue(act.contains("finish()"))
    }
}
```

- [x] **Step 2: 跑测试确认红**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.account.DeviceAccountScanServiceLaunchTrampolineTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -20`
Expected: 第一个用例 FAIL（`launchDouyinApp 必须调用 DouyinLaunchTrampoline.buildTrampolineIntent`）；第二个用例 PASS（Task 2 已实现）。

- [x] **Step 3: commit-1（先红）**

```bash
git add app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceLaunchTrampolineTest.kt
git commit -m "test(agent-android): launchDouyinApp 必须走 trampoline 且保留直启回退（先红）[29320ff1]"
```

- [x] **Step 4: 实现 — 替换 `launchDouyinApp()`**

把 `DeviceAccountScanService.kt:449-458` 的整个 `launchDouyinApp()` 替换为：

```kotlin
    /**
     * 拉起抖音（Brain task 29320ff1，decision 61298fc6）：先起自家透明 trampoline 让 App 成为
     * 前台 Activity、由它从前台拉起抖音——荣耀 iAware 等厂商策略拒绝"无前台 Activity 的调用方"
     * 直接 startActivity 第三方 App（真机 0/5 → LAUNCH_BLOCKED），自家 Activity 放行（3/3）。
     * trampoline 本身起不来（未知 OEM 也拦 / 抛异常）时退回原直启，行为 = 改动前，
     * 后续 awaitDouyinForeground() 仍是"抖音到前台了吗"的唯一裁判。
     */
    private fun launchDouyinApp(): Boolean = try {
        applicationContext.startActivity(
            DouyinLaunchTrampoline.buildTrampolineIntent(applicationContext, DOUYIN_PKG),
        )
        true
    } catch (e: Exception) {
        android.util.Log.w(TAG, "trampoline 启动失败(${e.message})，退回直接拉起抖音")
        launchDouyinDirect()
    }

    /** 改动前的直启实现，仅作 trampoline 起不来时的回退。 */
    private fun launchDouyinDirect(): Boolean = try {
        val launchIntent = applicationContext.packageManager.getLaunchIntentForPackage(DOUYIN_PKG)
        if (launchIntent == null) false
        else {
            launchIntent.addFlags(DouyinLaunchTrampoline.TARGET_FLAGS)
            applicationContext.startActivity(launchIntent)
            true
        }
    } catch (e: Exception) {
        android.util.Log.e(TAG, "launchDouyinApp failed: ${e.message}"); false
    }
```

- [x] **Step 5: 跑本任务测试 + 全量单测确认绿**

Run: `./gradlew :app:testDebugUnitTest -q --console=plain 2>&1 | grep -v "SDK processing" | tail -30`
Expected: 无失败输出。

- [x] **Step 6: commit-2**

```bash
git add app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "fix(agent-android): 账号扫描拉抖音先经透明 trampoline 过厂商后台启动拦截，直启回退 [29320ff1]"
```

---

### Task 4: 版本 bump

**Files:**
- Modify: `app/build.gradle.kts:14-15`

- [x] **Step 1: 改版本**

```kotlin
        versionCode = 25
        versionName = "2.1.21"
```

- [x] **Step 2: 确认既有版本上报测试仍绿**

Run: `./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.AgentVersionReportingTest' -q --console=plain 2>&1 | grep -v "SDK processing" | tail -10`
Expected: 无输出。

- [x] **Step 3: commit**

```bash
git add app/build.gradle.kts
git commit -m "chore(agent-android): bump 2.1.21 (versionCode 25) [29320ff1]"
```

---

### Task 5: 环境守卫 — 4号机真机 proven-to-fire 复验

**Files:** 无代码改动。使用本 session scratchpad 的 `launch-probe.sh`（路径：`/private/tmp/claude-501/-Users-administrator-worktrees-zenithjoy-session-fa43d237/3b09c3b3-cfdd-49af-90f9-c753097cd496/scratchpad/launch-probe.sh`；若不存在，按下方"探针要点"重写）。

探针要点：`ssh xian-rog "adb -s 192.168.1.96:5555 ..."`；每轮 `am force-stop 抖音` → `input keyevent HOME` → `logcat -c` → 广播 `am broadcast -a com.zenithjoy.agent.DEBUG_E2E -p com.zenithjoy.agent.e2e --es flow scan --es request_id <rid> --es device_id abdev --es tenant_id abtenant`（**不传 launch_mode**）→ 轮询 `logcat -d | grep "account scan result broadcast: requestId=<rid>"` 取 `ok=` 与 `error=`。

- [x] **Step 1: 打 e2e 包**

Run: `./gradlew :app:assembleE2e -q --console=plain 2>&1 | grep -v "SDK processing" | tail -5 && ls -la app/build/outputs/apk/e2e/app-e2e.apk`
Expected: APK 时间戳为当前时间。

- [x] **Step 2: 推到 rog 并装到 4号机**

Run: `scp -q app/build/outputs/apk/e2e/app-e2e.apk xian-rog:zj-trampoline.apk && ssh xian-rog "adb -s 192.168.1.96:5555 install -r C:\Users\asus\zj-trampoline.apk"`
Expected: `Success`。（跨境 scp 可能几分钟，用后台运行等待。）

- [x] **Step 3: 后台冷启动扫描 3 次（修前基线 0/5 红）**

Run: `<scratchpad>/launch-probe.sh bg 3`
Expected: 3 行 `ok=true accounts=<≥1> error=`；logcat 出现 `DouyinLaunchTrampoline: 已从前台 trampoline 拉起 com.ss.android.ugc.aweme` 与 `BAL_ALLOW_VISIBLE_WINDOW) result code=0`，**不再出现** `prevent start activity by iaware`。

- [x] **Step 4: 结果回写**

把 3 次结果（PASS 数、logcat 关键行）追加到 PR body 的「真机验证」段；未达 3/3 → 停下按 systematic-debugging 回 Phase 1，不加第二个补丁叠上去。

---

### Task 6: 收尾

- [x] **Step 1: 全量单测最终确认**

Run: `./gradlew :app:testDebugUnitTest -q --console=plain 2>&1 | grep -v "SDK processing" | tail -10`
Expected: 无失败。

- [x] **Step 2: 交给 finishing-a-development-branch（Option 2：push + PR）**

PR 标题：`fix(agent-android): 账号扫描 LAUNCH_BLOCKED——拉抖音先经透明 trampoline 过厂商后台启动拦截 [29320ff1]`
PR body 必含：根因 + 4号机对照表（后台直启 0/5 / overlay 0/3 / trampoline 3/3）+ 修后 Task 5 真机结果 + 决策链 964ba941/61298fc6/7ea333a3 + GP 锚点 `line02/keyword_acquisition#step5`。
