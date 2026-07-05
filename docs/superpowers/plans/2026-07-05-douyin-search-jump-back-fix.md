# 抖音搜索跳回首页 Bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `DouyinCollectService` 触发搜索后有时跳回搜索首页的 bug。

**Architecture:** 单文件改动。抽出两个纯函数（`isResultEventDebounced` / `shouldEnterSubmitting`）承载可测试的判定逻辑，新增 `State.SUBMITTING_SEARCH` 过渡态消除状态机竞态，修正 `triggerSearch()` fallback 动作语义，`handleSearchResults()` 接入防抖判定。

**Tech Stack:** Kotlin, JUnit4（无 mockk/Robolectric，故判定逻辑必须与 Android 类型解耦才可测）

## Global Constraints

- 唯一改动文件：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（生产代码）+ 新增测试文件
- 不改变现有对外广播接口（`ACTION_COLLECT_RESULT` / `EXTRA_*` 常量不变）
- TDD 顺序：每个 Task 内先写 failing test（commit-1），再实现让其转绿（commit-2）
- `RESULTS_SETTLE_MS` 固定为 400（毫秒），作为 companion object 常量，不做成可配置项（YAGNI）

---

### Task 1: 抽出防抖判定纯函数 + 新增过渡态，写 failing test

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinCollectServiceStateTest.kt`（新建）

**Interfaces:**
- Consumes: 无（本任务是最底层的纯逻辑单元）
- Produces：
  - `DouyinCollectService.Companion.isResultEventDebounced(triggeredAtMs: Long, nowMs: Long, settleMs: Long): Boolean` — `true` 表示应丢弃该结果事件（仍在防抖窗口内）
  - `DouyinCollectService.Companion.shouldEnterSubmitting(currentState: DouyinCollectService.State): Boolean` — 依赖 `State` 枚举（本任务同时把 `State` 从 `private` 改为 `internal`，新增 `SUBMITTING_SEARCH` 值，供测试文件在同 package 下访问）

- [ ] **Step 1: 写 failing test**

创建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinCollectServiceStateTest.kt`：

```kotlin
package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

class DouyinCollectServiceStateTest {

    // ── isResultEventDebounced ──────────────────────────────────────────────

    @Test
    fun `debounced when event arrives within settle window`() {
        val triggeredAt = 1_000L
        val now = 1_200L // 200ms 后，settle window 400ms 内
        assertTrue(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    @Test
    fun `not debounced when event arrives after settle window`() {
        val triggeredAt = 1_000L
        val now = 1_500L // 500ms 后，超过 400ms settle window
        assertFalse(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    @Test
    fun `boundary at exactly settle window is still debounced`() {
        val triggeredAt = 1_000L
        val now = 1_400L // 正好 400ms
        assertTrue(
            DouyinCollectService.isResultEventDebounced(triggeredAt, now, settleMs = 400L)
        )
    }

    // ── shouldEnterSubmitting ───────────────────────────────────────────────

    @Test
    fun `allows entering submitting only from TYPING_KEYWORD`() {
        assertTrue(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.TYPING_KEYWORD)
        )
    }

    @Test
    fun `rejects entering submitting from any other state`() {
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.WAITING_SEARCH_RESULTS)
        )
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.SUBMITTING_SEARCH)
        )
        assertFalse(
            DouyinCollectService.shouldEnterSubmitting(DouyinCollectService.State.IDLE)
        )
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.DouyinCollectServiceStateTest"`
Expected: 编译失败（`isResultEventDebounced` / `shouldEnterSubmitting` / `State.SUBMITTING_SEARCH` 均不存在），报 unresolved reference

- [ ] **Step 3: commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinCollectServiceStateTest.kt
git commit -m "test(agent-android): 抖音搜索防抖/过渡态纯函数 failing test"
```

- [ ] **Step 4: 实现最小代码让测试通过**

在 `DouyinCollectService.kt` 里做以下三处修改：

1. `State` 枚举改为 `internal`，新增 `SUBMITTING_SEARCH`（放在 `TYPING_KEYWORD` 和 `WAITING_SEARCH_RESULTS` 之间，仅为可读性，顺序不影响逻辑）：

```kotlin
    internal enum class State {
        IDLE,
        OPENING_DOUYIN,
        TYPING_KEYWORD,
        SUBMITTING_SEARCH,
        WAITING_SEARCH_RESULTS,
        OPENING_FIRST_VIDEO,
        OPENING_COMMENTS,
        EXTRACTING_COMMENTS,
    }
```

2. 在 `companion object` 内新增两个纯函数（放在现有常量之后、`dispatchTask` 之前）：

```kotlin
        /**
         * 触发搜索后短时间内的结果事件多半是过渡态渲染（联想词/历史列表刷新），
         * 不是真正的搜索结果页，需丢弃防止误点击。
         */
        internal fun isResultEventDebounced(triggeredAtMs: Long, nowMs: Long, settleMs: Long): Boolean {
            return nowMs - triggeredAtMs <= settleMs
        }

        /** 只有从 TYPING_KEYWORD 才允许进入 SUBMITTING_SEARCH，防止重复触发搜索。 */
        internal fun shouldEnterSubmitting(currentState: State): Boolean {
            return currentState == State.TYPING_KEYWORD
        }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.DouyinCollectServiceStateTest"`
Expected: PASS（5 个测试全绿）

- [ ] **Step 6: commit 实现**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "feat(agent-android): 新增搜索过渡态与结果防抖判定纯函数"
```

---

### Task 2: 接入过渡态 + 防抖判定 + 修正 fallback 动作，消除跳回首页 bug

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`

**Interfaces:**
- Consumes: Task 1 产出的 `isResultEventDebounced(triggeredAtMs, nowMs, settleMs)` / `shouldEnterSubmitting(currentState)` / `State.SUBMITTING_SEARCH`
- Produces: 无新公开接口，仅修正现有 `triggerSearch()` / `handleTypingKeyword()` / `handleSearchResults()` 的行为

> 本任务改的是真机行为逻辑，Task 1 已用纯函数覆盖了判定核心；本任务把这些判定接进实际状态机调用点，属于"胶水代码"，无法脱离 Android 框架单元测试，靠 Task 1 的纯函数测试 + CI 编译通过 + 真机验证兜底（不新增 test，遵循计划里"不过度设计测试基础设施"的边界）。

- [ ] **Step 1: 新增时间戳字段 + 修正 triggerSearch() fallback 动作与 state 切换时机**

在 `private var currentTaskId = ""` 后面新增字段：

```kotlin
    private var currentTaskId = ""
    private var searchTriggeredAtMs = 0L
```

把 `triggerSearch()`（当前第 207-221 行）替换为：

```kotlin
    private fun triggerSearch(root: AccessibilityNodeInfo) {
        val confirmBtn = findNodeByIds(root,
            "com.ss.android.ugc.aweme:id/search_confirm",
            "com.ss.android.ugc.aweme:id/btn_search",
        )
        if (confirmBtn != null) {
            confirmBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
            // 找不到确认按钮时，用 ACTION_IME_ENTER 确认 IME 的搜索/回车动作——
            // 之前误用 ACTION_NEXT_AT_MOVEMENT_GRANULARITY（按粒度移动光标），
            // 那不是提交搜索的动作，是这个 bug 的根因之一。
            val input = findFirstEditText(root)
            input?.performAction(AccessibilityNodeInfo.ACTION_IME_ENTER)
        }
        searchTriggeredAtMs = android.os.SystemClock.elapsedRealtime()
        state = State.WAITING_SEARCH_RESULTS
        startSearchResultTimeout()
    }
```

- [ ] **Step 2: 修正 handleTypingKeyword() 提前切 state 的竞态**

把 `handleTypingKeyword()`（当前第 248-261 行）替换为：

```kotlin
    private fun handleTypingKeyword(event: AccessibilityEvent) {
        // 等待搜索框出现（window change 后再输入）
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.packageName == DOUYIN_PKG
        ) {
            val root = rootInActiveWindow ?: return
            val input = findFirstEditText(root) ?: return
            if (shouldEnterSubmitting(state)) {
                // 切到 SUBMITTING_SEARCH（不是 WAITING_SEARCH_RESULTS）：这个过渡态在
                // onAccessibilityEvent 分发表里没有对应 handler，既防止 typeKeyword
                // 被重复调用，又不会让联想词/历史列表刷新事件被误路由到
                // handleSearchResults() 造成误点击。真正的 WAITING_SEARCH_RESULTS
                // 要等 triggerSearch() 真正发出搜索动作之后才切换。
                state = State.SUBMITTING_SEARCH
                typeKeyword(root)
            }
        }
    }
```

- [ ] **Step 3: handleSearchResults() 接入防抖判定**

把 `handleSearchResults()`（当前第 237-246 行）替换为：

```kotlin
    private fun handleSearchResults(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return
        if (state != State.WAITING_SEARCH_RESULTS) return
        if (isResultEventDebounced(searchTriggeredAtMs, android.os.SystemClock.elapsedRealtime(), RESULTS_SETTLE_MS)) return

        val root = rootInActiveWindow ?: return
        val videoCard = findFirstVideoCard(root) ?: return

        state = State.OPENING_FIRST_VIDEO
        videoCard.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }
```

- [ ] **Step 4: 新增 RESULTS_SETTLE_MS 常量**

在 `companion object` 里 `DOUYIN_PKG` 常量后面新增：

```kotlin
        private const val DOUYIN_PKG = "com.ss.android.ugc.aweme"
        private const val RESULTS_SETTLE_MS = 400L
```

- [ ] **Step 5: 编译验证**

Run: `cd services/agent-android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL（无 unresolved reference / 无未使用的 SUBMITTING_SEARCH 分支警告导致失败）

- [ ] **Step 6: 跑全部单元测试确认没有破坏其他用例**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest`
Expected: 全部 PASS（含 `DouyinCollectServiceStateTest` 5 个 + 已有 `NodeExtractorTest` 等）

- [ ] **Step 7: commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "fix(agent-android): 消除搜索状态机竞态+修正IME确认动作，解决触发搜索后偶发跳回首页"
```

---

## 验收标准

- [ ] Task 1 test 先以 failing 状态 commit，再转绿
- [ ] Task 2 三处修法全部落地，编译通过，全部单元测试绿
- [ ] CI（`services/agent-android` 相关 job）全绿
