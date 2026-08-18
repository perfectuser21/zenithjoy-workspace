# agent-android 无障碍等待模式统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 本会话禁用 subagent 派发 → 用 `superpowers:executing-plans` 逐 task inline 实施。Steps 用 checkbox (`- [ ]`) 跟踪。

**Goal:** 把三个无障碍 Service 里「拿一次界面快照就当它是目标页面」的写法，全部换成「等到条件满足再动作」，根治被修过四次的 `NO_SEARCH_INPUT`。

**Architecture:** 新增共享包 `com.zenithjoy.agent.uia`，内含纯轮询核心 `NodeAwait`（JVM 可单测，不碰 Android 框架）+ 薄的 `AccessibilityService.awaitNode` 扩展壳。三个 Service 的 16 个调用点逐处迁移为「等具体条件」，失败时归入 `NO_ROOT` / `WRONG_FOREGROUND` / `TARGET_ABSENT` 三态并打印可诊断日志。

**Tech Stack:** Kotlin、Android AccessibilityService、kotlinx.coroutines（`kotlinx-coroutines-test` 已在 `app/build.gradle.kts:83`）、JUnit4、Gradle。

**Spec:** `docs/superpowers/specs/2026-08-18-uia-await-condition-design.md`（commit d7d1a1d3）

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt` | 唯一的等待设施：纯轮询核心 + 失败分类 + Service 扩展壳 | 新建 |
| `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/uia/NodeAwaitTest.kt` | 原语的 8 条变异测试 | 新建 |
| `…/collect/DouyinCollectService.kt` | 采集链路，迁 4 处 | 改 |
| `…/collect/DouyinDmOutreachService.kt` | 私信链路，迁 9 处 + `awaitNode` 改委托 | 改 |
| `…/account/DeviceAccountScanService.kt` | 账号扫描，迁 3 处 + `awaitSwitchAccountPanel` 改委托 | 改 |
| `services/agent-android/app/build.gradle.kts` | 版本号 bump | 改 |

**命令速查**（CI 用 `gradle`，本地用 `./gradlew`，均在 `services/agent-android` 目录下执行）：
- 单测：`cd services/agent-android && ./gradlew :app:testDebugUnitTest`
- 构建 release APK：`cd services/agent-android && ./gradlew assembleRelease`

---

## Task 1: NodeAwait 原语（TDD）

**Files:**
- Create: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/uia/NodeAwaitTest.kt`
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt`

- [ ] **Step 1: 写失败测试（commit-1）**

创建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/uia/NodeAwaitTest.kt`：

```kotlin
package com.zenithjoy.agent.uia

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeAwaitTest {

    /** 测试替身：按脚本逐次返回快照，并记录 sleep 被调用了几次。 */
    private class Fixture(private val script: List<ProbeSnapshot<String>>) {
        var sleepCalls = 0
            private set
        private var index = 0
        val sleep: suspend (Long) -> Unit = { sleepCalls++ }
        val probe: () -> ProbeSnapshot<String> = {
            val snap = script[index.coerceAtMost(script.lastIndex)]
            index++
            snap
        }
    }

    private fun absent(pkg: String? = "com.ss.android.ugc.aweme") =
        ProbeSnapshot<String>(target = null, rootPresent = true, foregroundPkg = pkg)

    private fun present(pkg: String? = "com.ss.android.ugc.aweme") =
        ProbeSnapshot(target = "HIT", rootPresent = true, foregroundPkg = pkg)

    private fun noRoot() =
        ProbeSnapshot<String>(target = null, rootPresent = false, foregroundPkg = null)

    // 1. 前 3 次无目标、第 4 次出现 → 命中且不早退不多轮
    @Test
    fun `hits on fourth attempt without exiting early`() = runTest {
        val f = Fixture(listOf(absent(), absent(), absent(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals("HIT", outcome.value)
        assertEquals(4, outcome.attempts)
    }

    // 2. 始终不出现 → null 且用满 attempts
    @Test
    fun `exhausts attempts when target never appears`() = runTest {
        val f = Fixture(listOf(absent()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 6, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertFalse(outcome.hit)
        assertNull(outcome.value)
        assertEquals(6, outcome.attempts)
    }

    // 3. 首次即命中 → attempts=1 且 sleep 零调用（热路径零延迟）
    @Test
    fun `hot path does not sleep when target present immediately`() = runTest {
        val f = Fixture(listOf(present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 24, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals(1, outcome.attempts)
        assertEquals(0, f.sleepCalls)
    }

    // 4. 中途拿不到 root → 不崩、继续轮询、everSawRoot 反映曾见过
    @Test
    fun `keeps polling when root momentarily absent`() = runTest {
        val f = Fixture(listOf(noRoot(), noRoot(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertTrue(outcome.hit)
        assertEquals(3, outcome.attempts)
        assertTrue(outcome.everSawRoot)
    }

    // 5. 全程无 root → NO_ROOT
    @Test
    fun `classifies as NO_ROOT when root never available`() = runTest {
        val f = Fixture(listOf(noRoot()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertFalse(outcome.everSawRoot)
        assertEquals(
            WaitFailure.NO_ROOT,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 6. 有 root 但前台一直是别的包 → WRONG_FOREGROUND，且记下该包名
    @Test
    fun `classifies as WRONG_FOREGROUND when another app holds foreground`() = runTest {
        val f = Fixture(listOf(absent(pkg = "com.hihonor.systemmanager")))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals("com.hihonor.systemmanager", outcome.lastForegroundPkg)
        assertEquals(
            WaitFailure.WRONG_FOREGROUND,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 7. 前台是期望包但目标始终不出现 → TARGET_ABSENT
    @Test
    fun `classifies as TARGET_ABSENT when expected app shown but node missing`() = runTest {
        val f = Fixture(listOf(absent()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 4, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals(
            WaitFailure.TARGET_ABSENT,
            NodeAwait.classifyFailure(outcome, "com.ss.android.ugc.aweme")
        )
    }

    // 8. waitedMs 是间隔数×interval，不是次数×interval
    @Test
    fun `waitedMs counts intervals not attempts`() = runTest {
        val f = Fixture(listOf(absent(), absent(), absent(), present()))
        val outcome = NodeAwait.pollUntilPresent(
            maxAttempts = 10, intervalMs = 500, sleep = f.sleep, probe = f.probe
        )
        assertEquals(4, outcome.attempts)
        assertEquals(1500L, outcome.waitedMs(500))
    }
}
```

- [ ] **Step 2: 跑测试，确认它红**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests '*NodeAwaitTest*'
```

Expected: 编译失败，报 `Unresolved reference: NodeAwait` / `ProbeSnapshot` / `WaitFailure`（生产代码还不存在）。

- [ ] **Step 3: commit-1（只提测试）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/uia/NodeAwaitTest.kt
git commit -m "test(agent-android): NodeAwait 轮询原语 8 条变异测试（先红）

覆盖：第N次才命中不早退／耗尽attempts／热路径零sleep／root中途缺失不崩／
NO_ROOT|WRONG_FOREGROUND|TARGET_ABSENT 三态分类／waitedMs 按间隔数算。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现**

创建 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt`：

```kotlin
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
     * （旧实现 `return rootInActiveWindow` 会退回点击前的旧 root，见 DouyinCollectService 内注释）。
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
```

- [ ] **Step 5: 跑测试，确认全绿**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests '*NodeAwaitTest*'
```

Expected: `BUILD SUCCESSFUL`，8 个测试全过。

- [ ] **Step 6: commit-2（实现）**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt
git commit -m "feat(agent-android): NodeAwait 共享等待原语（等目标就绪，不再等到有窗口就动手）

纯轮询核心 pollUntilPresent（sleep/probe 可注入，JVM 单测不依赖 Android 框架）
+ classifyFailure 三态诊断 + AccessibilityService.awaitNode 薄壳。
超时明确失败，不再像旧 awaitRootInActiveWindow 那样 return rootInActiveWindow 兜底过期快照。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: proven-to-fire（亲眼看每条守卫报红）

**Files:** 临时改 `…/uia/NodeAwait.kt`，验证后**必须还原**

没见过它报红的守卫不算守卫。逐条弄坏、看红、还原。

- [ ] **Step 1: 弄坏「热路径零 sleep」**

把 `NodeAwait.kt` 里的

```kotlin
            if (attempts < maxAttempts) sleep(intervalMs)
```

临时改成

```kotlin
            sleep(intervalMs)
```

跑：`cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests '*NodeAwaitTest*'`
Expected: `hot path does not sleep when target present immediately` **FAILED**（expected:<0> but was:<1>）。
看到红之后**改回**。

- [ ] **Step 2: 弄坏「三态分类」**

把 `classifyFailure` 的第一个分支

```kotlin
        !outcome.everSawRoot -> WaitFailure.NO_ROOT
```

临时改成

```kotlin
        false -> WaitFailure.NO_ROOT
```

跑同一条命令。
Expected: `classifies as NO_ROOT when root never available` **FAILED**。
看到红之后**改回**。

- [ ] **Step 3: 弄坏「waitedMs 按间隔数算」**

把

```kotlin
    fun waitedMs(intervalMs: Long): Long = (attempts - 1).coerceAtLeast(0) * intervalMs
```

临时改成

```kotlin
    fun waitedMs(intervalMs: Long): Long = attempts * intervalMs
```

跑同一条命令。
Expected: `waitedMs counts intervals not attempts` **FAILED**（expected:<1500> but was:<2000>）。
看到红之后**改回**。

- [ ] **Step 4: 确认已完全还原且全绿**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests '*NodeAwaitTest*'
git diff --stat services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt
```

Expected: 测试全绿，且 `git diff` **无输出**（说明三次改动都已还原）。无需 commit。

---

## Task 3: 迁移 DouyinCollectService（4 处）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`

**贯穿本 task 的硬约束：**
- 选择器一律不动（真机 dump 271 节点实证 `content-desc="搜索"` 的 clickable Button 存在）
- 不移动、不绕过 `shouldEnterSubmitting(state)`（#1375 的 state 守卫）
- `SnapshotDiscipline.nextFetchToken` / `requireFresh` 的调用与相对位置原样保留

- [ ] **Step 1: 加 import 与常量**

文件头 import 区加：

```kotlin
import com.zenithjoy.agent.uia.NodeAwait
import com.zenithjoy.agent.uia.awaitNode
```

companion object 的常量区（`PER_CARD_TIMEOUT_MS` 附近）加：

```kotlin
        // ── 等待「目标就绪」的轮询预算（2026-08-18，替代旧的「等到有窗口就动手」）──
        // 上限均低于其所在链路的既有总预算：搜索入口 12s < SUBMIT_SEARCH_TIMEOUT_MS(15s)；
        // 详情页 6s < PER_CARD_TIMEOUT_MS(25s)；评论面板 4s < PER_LEAD_ENRICH_TIMEOUT_MS(20s)。
        private const val AWAIT_POLL_MS = 500L
        private const val AWAIT_SEARCH_ENTRY_ATTEMPTS = 24   // 12s，冷启动+厂商开屏广告余量
        private const val AWAIT_SEARCH_INPUT_ATTEMPTS = 8    // 4s
        private const val AWAIT_DETAIL_ATTEMPTS = 12         // 6s
        private const val AWAIT_COMMENT_PANEL_ATTEMPTS = 8   // 4s
        internal const val DOUYIN_PKG = "com.ss.android.ugc.aweme"
```

> 若同文件已存在 `DOUYIN_PKG` 常量，复用既有的，不要重复声明。

- [ ] **Step 2: 迁 `:385` openSearchBar（本 bug 核心）**

原代码：

```kotlin
            val root = awaitRootInActiveWindow() ?: run {
                finishWithError("NO_WINDOW")
                return@launch
            }
```

以及其后的

```kotlin
            val searchBtn = findNodeByContentDesc(root, "搜索") ?: findNodeByIds(root,
                "com.ss.android.ugc.aweme:id/search_btn",
                "com.ss.android.ugc.aweme:id/iv_search",
                "com.ss.android.ugc.aweme:id/action_search",
            )
            android.util.Log.i(TAG, "openSearchBar: searchBtn=${searchBtn != null}")
```

改为（把查找逻辑搬进 finder，等它出现而不是问它在不在）：

```kotlin
            val searchOutcome = awaitNode(AWAIT_SEARCH_ENTRY_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDesc(r, "搜索") ?: findNodeByIds(r,
                    "com.ss.android.ugc.aweme:id/search_btn",
                    "com.ss.android.ugc.aweme:id/iv_search",
                    "com.ss.android.ugc.aweme:id/action_search",
                )
            }
            val searchBtn = searchOutcome.value
            android.util.Log.i(
                TAG,
                "openSearchBar: searchBtn=${searchBtn != null} attempts=${searchOutcome.attempts} " +
                    "waitedMs=${searchOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${searchOutcome.lastForegroundPkg}"
            )
            if (searchBtn == null) {
                val failure = NodeAwait.classifyFailure(searchOutcome, DOUYIN_PKG)
                android.util.Log.w(TAG, "openSearchBar: 等待搜索入口超时 failure=$failure")
                finishWithError(if (failure == com.zenithjoy.agent.uia.WaitFailure.NO_ROOT) "NO_WINDOW" else "NO_SEARCH_INPUT")
                return@launch
            }
            val root = rootInActiveWindow ?: searchBtn
```

> 说明：原代码后续用 `root` 作为「找不到搜索框时的回退快照」。命中之后 `rootInActiveWindow` 一定可用，`?: searchBtn` 只是让类型非空、不会真的走到。实现时若 grep 确认 `root` 在该函数后续已无引用，直接删掉这一行，不要留无用变量。

- [ ] **Step 3: 迁 `:411` 点击搜索按钮后**

原代码：

```kotlin
            val postClickRoot = if (searchBtn != null) {
                clickNodeRobustly(searchBtn)
                delay(RandomDelay.sample(RandomDelay.CLICK_MS))
                awaitRootInActiveWindow(attempts = 4) ?: root
            } else {
                root
            }
```

改为（`searchBtn` 在 Step 2 之后已保证非 null，等的是搜索输入框出现）：

```kotlin
            clickNodeRobustly(searchBtn)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            val inputOutcome = awaitNode(AWAIT_SEARCH_INPUT_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByIds(r,
                    "com.ss.android.ugc.aweme:id/search_input",
                    "com.ss.android.ugc.aweme:id/search_edit_text",
                    "com.ss.android.ugc.aweme:id/et_search_kw",
                ) ?: findFirstEditText(r)
            }
            val postClickRoot = rootInActiveWindow ?: root
```

**其后的 `if (shouldEnterSubmitting(state)) { ... }` 整段原样保留，位置不变**（#1375 的守卫）。若该守卫内部用到 `postClickRoot`，继续用上面这个绑定。

> `inputOutcome` 只用于日志与诊断，不改变控制流——输入框没等到时仍由既有 state 守卫与 `typeKeyword` 的判空处理，避免动到 #1375 的语义。在该段之后补一行诊断日志：
> ```kotlin
>             android.util.Log.i(TAG, "openSearchBar: inputReady=${inputOutcome.hit} attempts=${inputOutcome.attempts}")
> ```

- [ ] **Step 4: 迁 `:725` tap 卡片后等详情页**

原代码：

```kotlin
                val detailRoot = awaitRootInActiveWindow(attempts = 6) ?: run {
                    android.util.Log.w(TAG, "capture abort card#$index: STEP1_detailRoot_null (tap didn't yield a window)")
                    return@withTimeoutOrNull null
                }
```

改为（等的是详情页里那个分享按钮真出现；`findShareLinkButton` 是 suspend、不能放进 finder，因此这里等一个廉价的详情页锚点：可点击的分享 content-desc 节点）：

```kotlin
                val detailOutcome = awaitNode(AWAIT_DETAIL_ATTEMPTS, AWAIT_POLL_MS) { r ->
                    findNodeByContentDescPrefix(r, "分享") ?: findNodeByContentDesc(r, "分享")
                }
                val detailRoot = rootInActiveWindow
                if (detailRoot == null || !detailOutcome.hit) {
                    val failure = NodeAwait.classifyFailure(detailOutcome, DOUYIN_PKG)
                    android.util.Log.w(
                        TAG,
                        "capture abort card#$index: STEP1_detail_not_ready failure=$failure " +
                            "attempts=${detailOutcome.attempts} waitedMs=${detailOutcome.waitedMs(AWAIT_POLL_MS)} " +
                            "fgPkg=${detailOutcome.lastForegroundPkg}"
                    )
                    return@withTimeoutOrNull null
                }
```

> 实现时先确认 `findNodeByContentDescPrefix` 在本文件确实存在（grep 已见 `:1296`）。若详情页分享按钮的 desc 在真机上不是「分享」开头，**不要猜**——保持等待条件为「详情页 root 可用且 `dumpNodeDescs` 能列出节点」，即退化为等 `rootInActiveWindow != null` 的轮询版本，并在 Task 8 真机验证时用 `dumpNodeDescs(detailRoot, "detail")` 的实际输出确定锚点后再收紧。

- [ ] **Step 5: 迁 `:1117` 评论面板**

原代码：

```kotlin
        val panelRoot = awaitRootInActiveWindow() ?: return null
        val avatar = findNodeByContentDesc(panelRoot, avatarContentDesc(nickname))
```

改为（等的是该昵称对应的头像 desc 节点或昵称文本节点出现）：

```kotlin
        val panelOutcome = awaitNode(AWAIT_COMMENT_PANEL_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodeByContentDesc(r, avatarContentDesc(nickname)) ?: findNodeByText(r, nickname)
        }
        val panelRoot = rootInActiveWindow ?: run {
            android.util.Log.d(
                TAG,
                "resolveDouyinIdForCommenter: 无窗口 failure=${NodeAwait.classifyFailure(panelOutcome, DOUYIN_PKG)}"
            )
            return null
        }
        val avatar = findNodeByContentDesc(panelRoot, avatarContentDesc(nickname))
```

其后的 `structuralAvatarTapPoint` 兜底与 `SnapshotDiscipline` token 推进（`:1131-1132`）**原样保留**。

> 若 `findNodeByText` 在本文件不存在，改用 `findNodeByContentDesc(r, avatarContentDesc(nickname))` 单条件——**不要新增查找工具函数**（spec §3.3 YAGNI）。

- [ ] **Step 6: 跑全量单测确认没打破既有测试**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest
```

Expected: `BUILD SUCCESSFUL`，含既有 `DouyinCollectServiceStateTest` 在内全绿。

- [ ] **Step 7: commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "fix(collect): 采集 4 处等待改为等目标就绪，根治冷启动必红 NO_SEARCH_INPUT

openSearchBar 不再拿闪屏页/厂商开屏广告页的 root 找搜索按钮，改为轮询等它出现（12s 上限）。
详情页、评论面板同治。超时日志带 attempts/waitedMs/fgPkg 与三态 failure，可区分
无障碍被撤销、厂商弹窗盖住、页面没加载完。选择器与 #1375 state 守卫均未改动。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 迁移 DouyinDmOutreachService（9 处 + 1 委托）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt`

**硬约束：** `SnapshotDiscipline.nextFetchToken` / `requireFresh`（`:196`、`:229-230`、`:435-436`）原样保留；`awaitDouyinForeground` 不动（它管第一层，本 task 管第二层）。

- [ ] **Step 1: 加 import 与常量**

```kotlin
import com.zenithjoy.agent.uia.NodeAwait
import com.zenithjoy.agent.uia.awaitNode
```

companion object（`DOUYIN_PKG` 已在 `:780`）加：

```kotlin
        // 等「目标就绪」的轮询预算（2026-08-18）。各步累计最坏 ≈44s，低于 lead 90s 熔断。
        private const val AWAIT_POLL_MS = 500L
        private const val AWAIT_ENTRY_ATTEMPTS = 24    // 12s：搜索入口/私信入口，含冷启动余量
        private const val AWAIT_PAGE_ATTEMPTS = 12     // 6s：结果页/主页等页面级跳转
        private const val AWAIT_WIDGET_ATTEMPTS = 8    // 4s：输入框/发送按钮等页内控件
```

- [ ] **Step 2: 迁 `:192` 私信入口**

原代码：

```kotlin
            val root = awaitRootInActiveWindow() ?: run {
                finishWithOutcome(dmEntryFound = false, sendConfirmed = false, errorCode = "NO_WINDOW")
                return@launch
            }
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeOpenToken)
```

改为（等私信入口节点出现；**保留** token 推进；`findClickableSelfOrAncestor` 与它的独立错误码留在 finder 外）：

```kotlin
            val entryOutcome = awaitNode(AWAIT_ENTRY_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDesc(r, "私信")
                    ?: findNodeByText(r, "发私信")
                    ?: findNodeByText(r, "私信")
                    ?: findNodeByIds(
                        r,
                        "com.ss.android.ugc.aweme:id/iv_im",
                        "com.ss.android.ugc.aweme:id/btn_im",
                        "com.ss.android.ugc.aweme:id/tv_send_msg",
                    )
            }
            fetchToken = SnapshotDiscipline.nextFetchToken(beforeOpenToken)
            val dmEntryRaw = entryOutcome.value
            if (dmEntryRaw == null) {
                val failure = NodeAwait.classifyFailure(entryOutcome, DOUYIN_PKG)
                android.util.Log.w(
                    TAG,
                    "dm entry 等待超时 failure=$failure attempts=${entryOutcome.attempts} " +
                        "waitedMs=${entryOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${entryOutcome.lastForegroundPkg}"
                )
                finishWithOutcome(
                    dmEntryFound = false, sendConfirmed = false,
                    errorCode = if (failure == com.zenithjoy.agent.uia.WaitFailure.NO_ROOT) "NO_WINDOW" else "NO_DM_ENTRY",
                )
                return@launch
            }
```

原先独立的 `val dmEntryRaw = findNodeByContentDesc(root, "私信") ?: ...` 与其后的 `if (dmEntryRaw == null) { ... NO_DM_ENTRY ... }` 整段**删除**（已合并进上面）。其后的 `findClickableSelfOrAncestor(dmEntryRaw)` 与 `NO_CLICKABLE_DM_ENTRY` 分支**原样保留**。

- [ ] **Step 3: 迁 `:231` 点私信后等输入框**

原代码：

```kotlin
            val postClickRoot = awaitRootInActiveWindow() ?: run {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_WINDOW_AFTER_DM_CLICK")
                return@launch
            }

            state = State.TYPING_MESSAGE
            val input = findFirstEditText(postClickRoot) ?: run {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_MESSAGE_INPUT")
                return@launch
            }
```

改为：

```kotlin
            val inputOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r -> findFirstEditText(r) }
            state = State.TYPING_MESSAGE
            val input = inputOutcome.value ?: run {
                val failure = NodeAwait.classifyFailure(inputOutcome, DOUYIN_PKG)
                android.util.Log.w(
                    TAG,
                    "dm input 等待超时 failure=$failure attempts=${inputOutcome.attempts} " +
                        "waitedMs=${inputOutcome.waitedMs(AWAIT_POLL_MS)} fgPkg=${inputOutcome.lastForegroundPkg}"
                )
                finishWithOutcome(
                    dmEntryFound = true, sendConfirmed = false,
                    errorCode = if (failure == com.zenithjoy.agent.uia.WaitFailure.NO_ROOT) "NO_WINDOW_AFTER_DM_CLICK" else "NO_MESSAGE_INPUT",
                )
                return@launch
            }
```

`fetchToken = SnapshotDiscipline.nextFetchToken(beforeClickToken)` 与 `SnapshotDiscipline.requireFresh(...)` **保持在这段之前，位置不变**。

- [ ] **Step 4: 迁 `:246` 发送按钮**

原代码：

```kotlin
            val sendRoot = awaitRootInActiveWindow() ?: postClickRoot
            val sendBtn = findNodeByContentDesc(sendRoot, "发送") ?: findNodeByIds(
                sendRoot,
                "com.ss.android.ugc.aweme:id/btn_send",
                "com.ss.android.ugc.aweme:id/send_btn",
            )
            if (sendBtn == null) {
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_SEND_BUTTON")
                return@launch
            }
```

改为：

```kotlin
            val sendOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDesc(r, "发送") ?: findNodeByIds(
                    r,
                    "com.ss.android.ugc.aweme:id/btn_send",
                    "com.ss.android.ugc.aweme:id/send_btn",
                )
            }
            val sendBtn = sendOutcome.value
            if (sendBtn == null) {
                android.util.Log.w(
                    TAG,
                    "dm send 按钮等待超时 failure=${NodeAwait.classifyFailure(sendOutcome, DOUYIN_PKG)} " +
                        "attempts=${sendOutcome.attempts} waitedMs=${sendOutcome.waitedMs(AWAIT_POLL_MS)}"
                )
                finishWithOutcome(dmEntryFound = true, sendConfirmed = false, errorCode = "NO_SEND_BUTTON")
                return@launch
            }
```

- [ ] **Step 5: 迁 `:262` 回执（等「状态成立」）**

原代码：

```kotlin
            val receiptRoot = awaitRootInActiveWindow()
            val sendConfirmed = receiptRoot != null && isInputCleared(receiptRoot, message)
```

改为（用 `takeIf` 把「输入框已清空」这个状态当作命中条件；这样是**等它变成清空**，而不是只看一眼）：

```kotlin
            val receiptOutcome = awaitNode(AWAIT_WIDGET_ATTEMPTS, AWAIT_POLL_MS) { r ->
                r.takeIf { isInputCleared(it, message) }
            }
            val sendConfirmed = receiptOutcome.hit
            android.util.Log.i(
                TAG,
                "dm receipt: confirmed=$sendConfirmed attempts=${receiptOutcome.attempts} " +
                    "waitedMs=${receiptOutcome.waitedMs(AWAIT_POLL_MS)}"
            )
```

> 这一处从「点完发送等一下看一眼」变成「等到真清空为止」，是本次对私信送达判定的实质增强——但判定标准本身（输入框清空 = sent）未改。

- [ ] **Step 6: 迁 `:362` / `:376` / `:399` / `:415` / `:437`**

按同一模式改写，各处的 finder 用**该处原本紧跟的查找表达式**，上限按下表：

| 行 | finder 取自 | attempts 常量 | 失败错误码 |
|---|---|---|---|
| `:362` | `findNodeByContentDesc(r, "搜索") ?: findNodeByIds(r, search_btn/iv_search/action_search)` | `AWAIT_ENTRY_ATTEMPTS` | `NO_ROOT`→`NO_WINDOW_BEFORE_SEARCH`，否则 `NO_SEARCH_INPUT` |
| `:376` | `findNodeByIds(r, search_input/search_edit_text/et_search_kw) ?: findFirstEditText(r)` | `AWAIT_WIDGET_ATTEMPTS` | 不改控制流，仅日志 |
| `:399` | 该处 `searchConfirm` 原本的 `findNodeByIds(...)` 表达式 | `AWAIT_WIDGET_ATTEMPTS` | 不改控制流，仅日志 |
| `:415` | **见下方 ⚠️** | `AWAIT_PAGE_ATTEMPTS` | `NO_SEARCH_RESULTS_WINDOW`（保留） |
| `:437` | `r.takeIf { collectAllNodeTexts(it).isNotEmpty() }` — 等主页**文本已渲染**，见下 ⚠️⚠️ | `AWAIT_PAGE_ATTEMPTS` | `NO_PROFILE_WINDOW`（保留） |

⚠️⚠️ **`:437` 的等待条件不要写成「等匹配成立」**：该处紧跟的判定是
`verifyProfileMatchesDouyinId(collectAllNodeTexts(profileRoot), targetDouyinId)`，失败时报 `NO_MATCH`
（语义是「这个主页不是目标人」）。若把 finder 写成「等到匹配成立」，则「真的不是目标人」会被拖成超时，
`NO_MATCH` 这个有意义的判定就被吃掉了。正确做法是只等**页面文本已渲染**
（`collectAllNodeTexts(it).isNotEmpty()`），随后 `verifyProfileMatchesDouyinId` 的判定逻辑与 `NO_MATCH`
分支**原样保留**。

⚠️ **`:415` 陷阱**：该处代码注释记载「抖音 39.4.0 真机实测：SearchResultActivity 的搜索结果列表**不进无障碍树**（自定义/Lynx 渲染）」。**不得**把等待条件设成「等结果列表项出现」——那个节点永远不会有。做法：保持该处原有判定逻辑完全不变，只把 `awaitRootInActiveWindow()` 换成 `awaitNode(AWAIT_PAGE_ATTEMPTS, AWAIT_POLL_MS) { it }`（等到有 root 即可，等价于原语义但耗时可控），并在日志里带上三态 failure。

- [ ] **Step 7: `:603` awaitNode 改为委托共享原语**

原代码：

```kotlin
    private suspend fun awaitNode(
        maxAttempts: Int = 6,
        delayMs: Long = 500,
        finder: (AccessibilityNodeInfo) -> AccessibilityNodeInfo?,
    ): AccessibilityNodeInfo? {
        repeat(maxAttempts) {
            awaitRootInActiveWindow()?.let { root -> finder(root)?.let { return it } }
            delay(delayMs)
        }
        return null
    }
```

删除它（共享原语的 `awaitNode` 扩展已提供同名能力）。所有原本调用这个私有 `awaitNode(...)` 并直接当 `AccessibilityNodeInfo?` 用的地方，改为取 `.value`：

```kotlin
// 原：val node = awaitNode(6, 500) { ... }
// 改：val node = awaitNode(6, 500) { ... }.value
```

**⚠️ 命名参数会编译失败**：现有两个调用点（`:527`、`:533`）写的是
`awaitNode(maxAttempts = 14, delayMs = 700) { ... }`，而共享原语的第二个参数叫 **`intervalMs`**。
删掉私有版本后这两处必须同时改名并取 `.value`：

```kotlin
// :527 原：var firstWork = awaitNode(maxAttempts = 14, delayMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }
        var firstWork = awaitNode(maxAttempts = 14, intervalMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }.value

// :533 原：firstWork = awaitNode(maxAttempts = 6, delayMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }
        firstWork = awaitNode(maxAttempts = 6, intervalMs = 700) { root -> findNodeByContentDescContains(root, "点赞数") }.value
```

用 `grep -n "awaitNode(" DouyinDmOutreachService.kt` 复查已无遗漏，确保编译通过。

> 顺带修掉的缺陷：原实现每轮内部还调 `awaitRootInActiveWindow()`（自带最多 4 秒），实际上限是 `maxAttempts × 4s` 而非 `maxAttempts × delayMs`。

- [ ] **Step 8: 跑单测**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest
```

Expected: `BUILD SUCCESSFUL`。

- [ ] **Step 9: commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt
git commit -m "fix(dm): 私信 9 处等待改为等目标就绪，回执改为等输入框真清空

私信入口/输入框/发送按钮/搜索入口/结果页/主页统一走 NodeAwait，超时带三态诊断。
回执判定从「等一下看一眼」改为「等到输入框真清空」，判定标准本身不变。
删除本文件私有 awaitNode（内部嵌套 awaitRootInActiveWindow 致真实上限不可控），
改用共享原语。SnapshotDiscipline token 推进与 awaitDouyinForeground 均未改动。
:415 结果列表是 Lynx 渲染不进无障碍树，按 spec 只换取 root 方式、判定逻辑不动。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 迁移 DeviceAccountScanService（3 处 + 1 委托）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`

- [ ] **Step 1: 加 import 与常量**

```kotlin
import com.zenithjoy.agent.uia.NodeAwait
import com.zenithjoy.agent.uia.awaitNode
```

```kotlin
        private const val AWAIT_POLL_MS = 500L
        private const val AWAIT_TAB_ATTEMPTS = 12       // 6s
        private const val AWAIT_LIST_ATTEMPTS = 8       // 4s
```

- [ ] **Step 2: 迁 `:324`「我」tab**

原代码：

```kotlin
            val preTapRoot = awaitRootInActiveWindow()
            val meTabNode = preTapRoot?.let {
                val candidate = findNodeByContentDescContains(it, "我，按钮") ?: findNodeByText(it, "我")
```

改为（等「我」tab 真出现）：

```kotlin
            val meTabOutcome = awaitNode(AWAIT_TAB_ATTEMPTS, AWAIT_POLL_MS) { r ->
                findNodeByContentDescContains(r, "我，按钮") ?: findNodeByText(r, "我")
            }
            val preTapRoot = rootInActiveWindow
            val meTabNode = meTabOutcome.value?.let { candidate ->
```

其后对 `candidate` 的位置校验逻辑（注释说明「用位置排除偶然精确等于"我"的 UGC 文案」）**原样保留**，只是它现在作用在轮询命中的节点上。若该逻辑内部引用 `preTapRoot`，保留上面的绑定。

命中失败时补日志：

```kotlin
            if (meTabOutcome.value == null) {
                android.util.Log.w(
                    TAG,
                    "「我」tab 等待超时 failure=${NodeAwait.classifyFailure(meTabOutcome, "com.ss.android.ugc.aweme")} " +
                        "attempts=${meTabOutcome.attempts}"
                )
            }
```

- [ ] **Step 3: `:411` awaitSwitchAccountPanel 改委托**

原代码：

```kotlin
    private suspend fun awaitSwitchAccountPanel(): AccessibilityNodeInfo? {
        repeat(4) {
            delay(800L)
            val checkRoot = rootInActiveWindow
            val panel = checkRoot?.takeIf { findNodeByIds(it, "com.ss.android.ugc.aweme:id/recycler_view") != null }
            if (panel != null) return panel
        }
        return null
    }
```

改为（行为等价：4×800ms；但走共享原语，且不再是「先睡再看」而是「先看再睡」——面板已展开时立即返回）：

```kotlin
    private suspend fun awaitSwitchAccountPanel(): AccessibilityNodeInfo? =
        awaitNode(maxAttempts = 4, intervalMs = 800L) { root ->
            root.takeIf { findNodeByIds(it, "com.ss.android.ugc.aweme:id/recycler_view") != null }
        }.value
```

- [ ] **Step 4: 迁 `:569` 昵称列表**

原代码：

```kotlin
            val root = awaitRootInActiveWindow() ?: return null
            val nicknames = filterAccountNicknames(
                findNodesByIds(root, "com.ss.android.ugc.aweme:id/tv_nickname").map { it.text?.toString() }
            )
```

改为（等至少一个昵称节点出现）：

```kotlin
            val listOutcome = awaitNode(AWAIT_LIST_ATTEMPTS, AWAIT_POLL_MS) { r ->
                r.takeIf { findNodesByIds(it, "com.ss.android.ugc.aweme:id/tv_nickname").isNotEmpty() }
            }
            val root = listOutcome.value ?: run {
                android.util.Log.w(
                    TAG,
                    "账号列表等待超时 failure=${NodeAwait.classifyFailure(listOutcome, "com.ss.android.ugc.aweme")}"
                )
                return null
            }
            val nicknames = filterAccountNicknames(
                findNodesByIds(root, "com.ss.android.ugc.aweme:id/tv_nickname").map { it.text?.toString() }
            )
```

- [ ] **Step 5: 迁 `:707` 面板中指定昵称行**

原代码：

```kotlin
        val panel = awaitRootInActiveWindow() ?: return false
        val row = findNodesByIds(panel, "com.ss.android.ugc.aweme:id/tv_nickname")
            .firstOrNull { it.text?.toString()?.trim() == nickname } ?: run {
                android.util.Log.w(TAG, "切换账号面板里找不到昵称=$nickname")
                return false
            }
```

改为（等这一行出现）：

```kotlin
        val rowOutcome = awaitNode(AWAIT_LIST_ATTEMPTS, AWAIT_POLL_MS) { r ->
            findNodesByIds(r, "com.ss.android.ugc.aweme:id/tv_nickname")
                .firstOrNull { it.text?.toString()?.trim() == nickname }
        }
        val row = rowOutcome.value ?: run {
            android.util.Log.w(
                TAG,
                "切换账号面板里找不到昵称=$nickname failure=${NodeAwait.classifyFailure(rowOutcome, "com.ss.android.ugc.aweme")} " +
                    "attempts=${rowOutcome.attempts}"
            )
            return false
        }
```

- [ ] **Step 6: 跑单测**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest
```

Expected: `BUILD SUCCESSFUL`。

- [ ] **Step 7: commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "fix(account-scan): 账号扫描 3 处等待改为等目标就绪，切号面板改委托共享原语

「我」tab／账号昵称列表／切号面板指定行统一走 NodeAwait；awaitSwitchAccountPanel
行为等价（4x800ms）但改为先看再睡，面板已展开时立即返回。超时日志带三态诊断。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: bump agent 版本号

**Files:**
- Modify: `services/agent-android/app/build.gradle.kts:14-15`

- [ ] **Step 1: 改版本**

```kotlin
        versionCode = 28
        versionName = "2.1.24"
```

（当前值为 `27` / `"2.1.23"`。）

- [ ] **Step 2: commit**

```bash
git add services/agent-android/app/build.gradle.kts
git commit -m "chore(agent-android): bump 2.1.23 -> 2.1.24（无障碍等待模式统一）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 构建 APK 并装到复现机

- [ ] **Step 1: 构建**

```bash
cd services/agent-android && ./gradlew assembleRelease
```

Expected: `BUILD SUCCESSFUL`。产物在 `services/agent-android/app/build/outputs/apk/release/`，用 `ls -lh` 确认文件名与大小。

- [ ] **Step 2: 记录小粉当前的无障碍授权值（装包会被静默撤销）**

```bash
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell settings get secure enabled_accessibility_services'
```

把输出**原样存下来**，Step 4 要写回去。

- [ ] **Step 3: 传包并安装**

```bash
scp services/agent-android/app/build/outputs/apk/release/<实际文件名>.apk xian-m4:/tmp/zj-agent.apk
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 install -r /tmp/zj-agent.apk'
```

Expected: `Success`。

- [ ] **Step 4: 写回无障碍授权并确认版本**

```bash
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell settings put secure enabled_accessibility_services "<Step2 存下的原值>"'
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell settings put secure accessibility_enabled 1'
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell dumpsys package com.zenithjoy.agent | grep -m1 versionName'
```

Expected: `versionName=2.1.24`，且 `dumpsys accessibility | grep "Enabled services"` 能看到 zenithjoy 的服务。

---

## Task 8: 真机三链路验证

本次动了全部三个 Service，三条链路都要验。**采集必须在冷启动场景验**——热启动跑不出这个 bug。

- [ ] **Step 1: 采集链路（小粉，冷启动）**

```bash
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell am force-stop com.ss.android.ugc.aweme'
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell logcat -c'
ssh xian-m4 'cd /tmp/zj-smoke-main && ADB=/opt/homebrew/bin/adb ANDROID_ADB_ENDPOINT=192.168.3.9:5555 bash .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh; echo EXIT=$?'
```

Expected（判据，全部满足才算过）：
- 日志出现 `openSearchBar: searchBtn=true attempts=<n>`，且 `n > 1`（证明**确实等了**，不是碰巧第一次就有）
- 出现 `handleSearchResults: ... cards=<m>`，`m > 0`
- 采集任务终态**不是** `KEYWORD_NO_RESULT`

抓日志：

```bash
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell "logcat -d | grep -E \"openSearchBar|handleSearchResults|collect error\" | head -12"'
```

- [ ] **Step 2: 私信链路回归（小黄）**

先把新包也装到小黄（重复 Task 7 的 Step 2-4，设备换 `192.168.3.236:5555`），然后：

```bash
ssh xian-m4 'cd /tmp/zj-smoke-main && ADB=/opt/homebrew/bin/adb ANDROID_ADB_ENDPOINT=192.168.3.236:5555 bash .github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh; echo EXIT=$?'
```

Expected: `outcome=SENT`，`EXIT=0`（08-17 该链路刚验证过 SENT，本次属回归重点）。

- [ ] **Step 3: 账号扫描链路（小粉或小黄）**

```bash
ssh xian-m4 '/opt/homebrew/bin/adb -s 192.168.3.9:5555 shell logcat -c'
ssh xian-m4 'cd /tmp/zj-smoke-main && ADB=/opt/homebrew/bin/adb ANDROID_ADB_ENDPOINT=192.168.3.9:5555 bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh; echo EXIT=$?'
```

Expected: 返回账号数 ≥1，日志中**无**「面板未出现」类误判。

- [ ] **Step 4: 把三条链路的实际输出贴进 PR 描述**（Task 9 用）

---

## Task 9: push 并开 PR

- [ ] **Step 1: 确认全绿并推送**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest
cd /Users/administrator/worktrees/zenithjoy/session-faf25c36
git push -u origin cp-08181120-uia-await-condition
```

- [ ] **Step 2: 开 PR**

标题：`fix(agent-android): 无障碍等待改为等目标就绪，根治被修四次的 NO_SEARCH_INPUT`

> 本 PR 未改 `.github/` 下任何文件，**不需要** `[CONFIG]` 前缀。若实施中确实动了 workflow，标题必须加 `[CONFIG]`（PR **标题**上加才算数，加在 commit 上无效）。

PR body 必须包含：
- GP-Anchor 行（**裸值，不要加反引号**）：`GP-Anchor: line02/keyword_acquisition keep-green`
- 四次修复历史表（spec §1）
- 真机 A/B 对照证据
- Task 8 三条链路的实际输出
- `Brain task 2b66aecf-9217-4d3d-8819-1876e95713d9`｜`decision d1ec2a78-b613-45c7-ad4c-24f7cbc4341b`

- [ ] **Step 3: 启用 auto-merge，交给 engine-pr-watchdog 盯到合并**

```bash
gh pr merge <PR号> --repo perfectuser21/zenithjoy-workspace --auto --squash
```

---

## 完成判据

- [ ] `NodeAwaitTest` 8 条全绿，且 Task 2 三条 proven-to-fire 都亲眼见过红
- [ ] 16 个调用点全部迁移；三个 Service 中不再有「拿到 root 直接 findNode 判死」的写法
- [ ] 三条真机链路各自 PASS，采集是在**冷启动**场景下 PASS
- [ ] agent 版本已 bump 到 2.1.24 / versionCode 28
- [ ] CI 全绿，PR 合并
