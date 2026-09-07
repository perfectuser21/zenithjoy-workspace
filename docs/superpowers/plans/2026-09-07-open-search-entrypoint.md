# 信号桥"打开搜索并输入关键词"命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给信号桥（`adb-controller-bridge.sh` → `phonectl.sh` → 中台 API → `agent-android`）新增一条 `open-search-evidence <keyword> <evidence_id>` 命令，让 OpenClaw discovery 阶段能真正打开抖音搜索框、写入中文关键词、提交搜索。

**Architecture:** 新增指令 `OPEN_SEARCH` 沿着现有 8 指令的三层结构（`CommandProtocol` 解析 → `CommandExecutor` 门禁分发 → 新建 `OpenSearchRunner`）实现，`OpenSearchRunner` 采用与 `TypeRunner`/`LaunchRunner` 一致的"纯函数式回调注入"模式（不直接持有 `AccessibilityNodeInfo`，保持可单测），真正的节点定位/`ACTION_SET_TEXT`/三态提交逻辑作为回调在 `AgentService.kt` 装配点实现（复用已有的 `com.zenithjoy.agent.uia.awaitNode` 共享轮询设施，算法参照 `DouyinCollectService.kt:489-675` 但不直接调用其私有方法）。桥接层新增 `open-search-evidence` 命令 + 三处 action 白名单同步（`CommandProtocol`/`devices.ts`/`phonectl.sh`）+ command-trace 留痕。

**Tech Stack:** Kotlin (JUnit4 + kotlinx-coroutines-test) / TypeScript (中台 API 路由) / Bash + Node `node:test`（bridge 脚本测试）

---

## Task 1: `CommandProtocol.kt` — 新增 `OPEN_SEARCH` 指令类型 + 解析 + 错误码

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandProtocol.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandProtocolTest.kt`

- [ ] **Step 1: 写失败测试**

在 `CommandProtocolTest.kt` 的 `未知 action 报 UNKNOWN_ACTION` 测试后面加：

```kotlin
    @Test fun `open_search 合法关键词解析成功`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "open_search", "keyword" to "装修"), SW, SH)
        r as ParseOutcome.Ok
        assertEquals(CmdAction.OPEN_SEARCH, r.request.action)
        assertEquals("装修", r.request.args["keyword"])
    }

    @Test fun `open_search 缺 keyword 拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "open_search"), SW, SH)
        r as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_BAD_REQUEST, r.code)
    }

    @Test fun `open_search keyword 为空字符串拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "open_search", "keyword" to ""), SW, SH)
        r as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_BAD_REQUEST, r.code)
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandProtocolTest"`
Expected: FAIL（`CmdAction.OPEN_SEARCH` 不存在，编译错误）

- [ ] **Step 3: 实现**

`CommandProtocol.kt:4` 改：
```kotlin
enum class CmdAction { SCREENSHOT, TAP, SWIPE, TYPE, KEY, LAUNCH, DEVICE_INFO, TREE_DUMP, OPEN_SEARCH }
```

`CommandProtocol.kt:17-36` 错误码常量区（`ERR_TREE_UNAVAILABLE` 后）加两个新常量：
```kotlin
    const val ERR_SEARCH_ENTRY_NOT_FOUND = "SEARCH_ENTRY_NOT_FOUND"
    const val ERR_SEARCH_SUBMIT_FAILED = "SEARCH_SUBMIT_FAILED"
```

`CommandProtocol.kt:44-53` 的 `when` 分支加一行（`"tree_dump" -> CmdAction.TREE_DUMP` 后）：
```kotlin
            "open_search" -> CmdAction.OPEN_SEARCH
```

`CommandProtocol.kt:56-88` 的 `when (action) { ... }` 加一个分支（`CmdAction.LAUNCH -> { ... }` 后，`else -> Unit` 前）：
```kotlin
            CmdAction.OPEN_SEARCH -> {
                val keyword = payload["keyword"] as? String
                if (keyword.isNullOrEmpty()) return bad("missing keyword")
                args["keyword"] = keyword
            }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandProtocolTest"`
Expected: PASS（全部测试，包括新增 3 条）

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandProtocol.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandProtocolTest.kt
git commit -m "feat(agent-android): CommandProtocol新增OPEN_SEARCH指令类型"
```

---

## Task 2: `OpenSearchRunner.kt` — 新建 Runner（回调注入模式，不直接碰 AccessibilityNodeInfo）

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/OpenSearchRunner.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/OpenSearchRunnerTest.kt`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenSearchRunnerTest {
    private val WL = setOf("com.ss.android.ugc.aweme")

    @Test fun `前台不在白名单拒绝`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.android.settings" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("装修").errorCode)
    }

    @Test fun `搜索入口找不到回 SEARCH_ENTRY_NOT_FOUND`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { null },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_SEARCH_ENTRY_NOT_FOUND, r.run("装修").errorCode)
    }

    @Test fun `输入框找不到回 NO_FOCUSED_EDITABLE`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { null },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_NO_FOCUSED_EDITABLE, r.run("装修").errorCode)
    }

    @Test fun `SET_TEXT 失败回 SET_TEXT_FAILED`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { false },
            submitSearch = { true },
        )
        assertEquals(CommandProtocol.ERR_SET_TEXT_FAILED, r.run("装修").errorCode)
    }

    @Test fun `提交失败回 SEARCH_SUBMIT_FAILED`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { false },
        )
        assertEquals(CommandProtocol.ERR_SEARCH_SUBMIT_FAILED, r.run("装修").errorCode)
    }

    @Test fun `成功路径`() = runTest {
        val r = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = WL,
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { true },
        )
        assertTrue(r.run("装修").ok)
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.OpenSearchRunnerTest"`
Expected: FAIL（`OpenSearchRunner` 类不存在，编译错误）

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

/**
 * open_search 指令：定位搜索入口 → 点击 → 写入关键词 → 提交搜索。
 * 白名单硬红线同 TypeRunner（首版只放抖音系）。
 * 三个回调的语义（均由 AgentService.kt 装配，真正的节点查找/ACTION_SET_TEXT/
 * dispatchGesture 逻辑在那边实现，本类保持不碰 AccessibilityNodeInfo 以便纯单测）：
 * - openSearchEntry: null=未知/不适用（本类不使用此值，保留 Boolean? 是为了未来可能的语义扩展，
 *   当前仅 true 视为找到并点击成功，其余（false 或抛异常前的 null）一律 SEARCH_ENTRY_NOT_FOUND）
 * - typeKeyword: null=没找到输入框；true/false=ACTION_SET_TEXT 执行结果
 * - submitSearch: 三态提交（确认按钮/文本节点手势/IME回车）是否有任一途径成功
 */
class OpenSearchRunner(
    private val foregroundPkg: () -> String?,
    private val whitelist: Set<String>,
    private val openSearchEntry: suspend () -> Boolean?,
    private val typeKeyword: suspend (String) -> Boolean?,
    private val submitSearch: suspend () -> Boolean,
) {
    suspend fun run(keyword: String): CmdOutcome {
        val pkg = foregroundPkg()
        if (pkg == null || pkg !in whitelist) {
            return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to (pkg ?: "unknown")))
        }
        if (openSearchEntry() != true) {
            return CmdOutcome(false, CommandProtocol.ERR_SEARCH_ENTRY_NOT_FOUND)
        }
        when (typeKeyword(keyword)) {
            null -> return CmdOutcome(false, CommandProtocol.ERR_NO_FOCUSED_EDITABLE)
            false -> return CmdOutcome(false, CommandProtocol.ERR_SET_TEXT_FAILED)
            true -> Unit
        }
        if (!submitSearch()) {
            return CmdOutcome(false, CommandProtocol.ERR_SEARCH_SUBMIT_FAILED)
        }
        return CmdOutcome(true)
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.OpenSearchRunnerTest"`
Expected: PASS（6 条全绿）

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/OpenSearchRunner.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/OpenSearchRunnerTest.kt
git commit -m "feat(agent-android): 新增OpenSearchRunner(回调注入模式)"
```

---

## Task 3: `CommandExecutor.kt` — 接入 `OPEN_SEARCH` 门禁与分发

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandExecutor.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt`

- [ ] **Step 1: 写失败测试**

在 `CommandExecutorTest.kt` 的 `executor(...)` 工厂函数里加一个 `openSearch` 默认参数（找到该函数当前签名，参照其它 Runner 参数风格加一行，默认给一个总是成功的假实现），然后加测试：

```kotlin
    @Test fun `远程协助关闭时 open_search 拒绝`() = runTest {
        val e = executor(remoteEnabled = false)
        assertEquals(
            CommandProtocol.ERR_REMOTE_CONTROL_DISABLED,
            e.execute(req(CmdAction.OPEN_SEARCH, mapOf("keyword" to "装修")))["errorCode"],
        )
    }

    @Test fun `原生忙时 open_search 拒绝`() = runTest {
        val e = executor(nativeBusyProbe = { true })
        assertEquals(
            CommandProtocol.ERR_DEVICE_BUSY_NATIVE,
            e.execute(req(CmdAction.OPEN_SEARCH, mapOf("keyword" to "装修")))["errorCode"],
        )
    }

    @Test fun `open_search 正常路径 ok`() = runTest {
        val e = executor()
        assertEquals(true, e.execute(req(CmdAction.OPEN_SEARCH, mapOf("keyword" to "装修")))["ok"])
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandExecutorTest"`
Expected: FAIL（`executor(...)` 工厂函数没有 `openSearch` 参数/`CommandExecutor` 构造函数没有对应参数，编译错误）

- [ ] **Step 3: 实现**

`CommandExecutor.kt:9-20` 构造函数加一个参数（`launch: LaunchRunner,` 后）：
```kotlin
    private val openSearch: OpenSearchRunner,
```

`CommandExecutor.kt:21-22` 门禁集合加 `OPEN_SEARCH`：
```kotlin
    private val mutating = setOf(CmdAction.TAP, CmdAction.SWIPE, CmdAction.TYPE, CmdAction.KEY, CmdAction.LAUNCH, CmdAction.OPEN_SEARCH)
    private val sensitive = setOf(CmdAction.SCREENSHOT, CmdAction.TYPE, CmdAction.TREE_DUMP, CmdAction.OPEN_SEARCH)
```

`CommandExecutor.kt:52-71` 的 `when (req.action) { ... }` 加一个分支（`CmdAction.LAUNCH -> launch.run(...)` 后）：
```kotlin
            CmdAction.OPEN_SEARCH -> openSearch.run(req.args["keyword"] as String)
```

`CommandExecutorTest.kt:12-28` 的 `executor(...)` 工厂函数改为：
```kotlin
    private fun executor(
        remoteEnabled: Boolean = true,
        nativeBusy: Boolean = false,
        nativeBusyProbe: () -> Boolean = { nativeBusy },
        treeDump: () -> Map<String, Any?>? = { mapOf("tree" to "d0 root", "truncated" to false) },
    ) = CommandExecutor(
        remoteControlEnabled = { remoteEnabled },
        nativeBusy = nativeBusyProbe,
        foregroundPkg = { "com.ss.android.ugc.aweme" },
        gesture = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true }),
        screenshot = ScreenshotRunner({ true }, { true }, { "b64" }, { 1080 to 2400 }, sleep = {}),
        type = TypeRunner({ "com.ss.android.ugc.aweme" }, setOf("com.ss.android.ugc.aweme"), { true }),
        launch = LaunchRunner(setOf("com.ss.android.ugc.aweme"), { true }, { true }, { "com.ss.android.ugc.aweme" }, sleep = {}),
        openSearch = OpenSearchRunner(
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            whitelist = setOf("com.ss.android.ugc.aweme"),
            openSearchEntry = { true },
            typeKeyword = { true },
            submitSearch = { true },
        ),
        globalAction = { true },
        deviceInfo = { mapOf("model" to "TEST") },
        treeDump = treeDump,
    )
```
（只新增了 `openSearch = OpenSearchRunner(...)` 这一行，其余保持不变。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandExecutorTest"`
Expected: PASS（含既有测试 + 新增 3 条）

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandExecutor.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt
git commit -m "feat(agent-android): CommandExecutor接入OPEN_SEARCH门禁与分发"
```

---

## Task 4: `AgentService.kt` — 装配 `OpenSearchRunner` 真实回调（无障碍服务节点操作）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`

这一步是唯一真正碰 `AccessibilityNodeInfo`/`awaitNode` 的地方，算法参照 `DouyinCollectService.kt:489-675`（`openSearchBar`/`typeKeyword`/`triggerSearch`）与其私有节点查找工具（`DouyinCollectService.kt:1542-1728`）改写为独立实现，不跨类调用私有方法。此步骤涉及真实 Android 框架 API（`AccessibilityNodeInfo`/`AccessibilityService`/`GestureDescription`），无法在纯 JVM 单测里验证，靠 Task 9 真机验证收口。

- [ ] **Step 1: 无失败测试可写（真机专属逻辑）——跳过 TDD，直接实现，Task 9 真机验证兜底**

- [ ] **Step 2: 实现**

在 `AgentService.kt` 顶部 import 区加：
```kotlin
import com.zenithjoy.agent.command.OpenSearchRunner
import com.zenithjoy.agent.uia.awaitNode
```

在 `AgentService.kt:596`（`launch = LaunchRunner(...)` 代码块结束）之后、`globalAction = { ... }`（`AgentService.kt:598`）之前插入：

```kotlin
            openSearch = OpenSearchRunner(
                foregroundPkg = cmdForegroundPkg,
                whitelist = cmdWhitelist,
                openSearchEntry = {
                    val svc = DouyinCollectService.commandHost()
                    if (svc == null) {
                        false
                    } else {
                        val outcome = svc.awaitNode(24, 500L, expectPkg = "com.ss.android.ugc.aweme") { r ->
                            openSearchFindNodeByContentDescCheap(r, "搜索") ?: openSearchFindNodeByIds(r,
                                "com.ss.android.ugc.aweme:id/search_btn",
                                "com.ss.android.ugc.aweme:id/iv_search",
                                "com.ss.android.ugc.aweme:id/action_search",
                            )
                        }
                        val btn = outcome.value
                        if (btn == null) {
                            false
                        } else {
                            openSearchClickRobustly(svc, btn)
                            true
                        }
                    }
                },
                typeKeyword = { keyword ->
                    val svc = DouyinCollectService.commandHost()
                    val root = svc?.rootInActiveWindow
                    if (svc == null || root == null) {
                        null
                    } else {
                        val inputOutcome = svc.awaitNode(8, 500L, expectPkg = "com.ss.android.ugc.aweme") { r ->
                            openSearchFindNodeByIds(r,
                                "com.ss.android.ugc.aweme:id/search_input",
                                "com.ss.android.ugc.aweme:id/search_edit_text",
                                "com.ss.android.ugc.aweme:id/et_search_kw",
                            )
                        }
                        val input = inputOutcome.value ?: openSearchFindFirstEditText(svc.rootInActiveWindow ?: root)
                        if (input == null) {
                            null
                        } else {
                            input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                            val args = Bundle().apply {
                                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, keyword)
                            }
                            input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                        }
                    }
                },
                submitSearch = {
                    val svc = DouyinCollectService.commandHost()
                    val root = svc?.rootInActiveWindow
                    if (svc == null || root == null) {
                        false
                    } else {
                        val confirmBtn = openSearchFindNodeByIds(root,
                            "com.ss.android.ugc.aweme:id/search_confirm",
                            "com.ss.android.ugc.aweme:id/btn_search",
                        )
                        val searchTextNode = openSearchFindNodeByText(root, "搜索")
                        when {
                            confirmBtn != null -> confirmBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                            searchTextNode != null -> {
                                openSearchTapNodeCenter(svc, searchTextNode)
                                true
                            }
                            else -> {
                                val input = openSearchFindFirstEditText(root)
                                input?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) ?: false
                            }
                        }
                    }
                },
            ),
```

在 `AgentService.kt` 类内部（同一个包，作为私有辅助函数，放在 `callStateProbe()` 附近即可）新增节点查找辅助函数——**这些是 `open_search` 专属的私有拷贝，不跨类调用 `DouyinCollectService` 的同名私有方法**（与既有代码库"每个服务各自一份"的既定模式一致，详见设计文档"决策 2"）：

```kotlin
    /** open_search 专属：廉价 content-desc 精确匹配（算法参照 DouyinCollectService.findNodeByContentDescCheap）。 */
    private fun openSearchFindNodeByContentDescCheap(root: AccessibilityNodeInfo, desc: String): AccessibilityNodeInfo? {
        root.findAccessibilityNodeInfosByText(desc)?.firstOrNull {
            it.contentDescription?.toString()?.trim() == desc || it.text?.toString()?.trim() == desc
        }?.let { return it }
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < 400) {
            val node = queue.removeFirst()
            visited++
            if (node.contentDescription?.toString()?.trim() == desc) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun openSearchFindNodeByIds(root: AccessibilityNodeInfo, vararg ids: String): AccessibilityNodeInfo? {
        for (id in ids) {
            val list = root.findAccessibilityNodeInfosByViewId(id)
            if (list.isNotEmpty()) return list[0]
        }
        return null
    }

    private fun openSearchFindNodeByText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.text?.toString() == text) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun openSearchFindFirstEditText(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.className?.contains("EditText") == true) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    /** 自身可点击走 ACTION_CLICK；否则退回坐标手势（抖音混淆节点 clickable=false 常见）。 */
    private fun openSearchClickRobustly(svc: android.accessibilityservice.AccessibilityService, node: AccessibilityNodeInfo) {
        if (node.isClickable) {
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
            openSearchTapNodeCenter(svc, node)
        }
    }

    private fun openSearchTapNodeCenter(svc: android.accessibilityservice.AccessibilityService, node: AccessibilityNodeInfo) {
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.isEmpty) return
        val path = Path().apply { moveTo(bounds.centerX().toFloat(), bounds.centerY().toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        svc.dispatchGesture(gesture, null, null)
    }
```

- [ ] **Step 3: 编译确认无误**

Run: `cd services/agent-android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
git commit -m "feat(agent-android): 装配OpenSearchRunner真实无障碍服务回调"
```

---

## Task 5: 中台 `devices.ts` — `open_search` 加入 `ACTION_WHITELIST`

**Files:**
- Modify: `apps/api/src/routes/devices.ts`
- Test: `apps/api/src/routes/__tests__/devices.test.ts`

- [ ] **Step 1: 写失败测试**

在 `devices.test.ts` 的 `describe('action 白名单 + 请求体', ...)` 块里（`未知 action → 400 UNKNOWN_ACTION` 用例之后），参照同块内 `tenant 绝不从请求体取` 用例的 `post({...})` 调用风格新增（`beforeEach` 已调用 `okDispatch()`，`dispatchAndWait` 默认成功，无需额外 mock）：

```typescript
  it('action=open_search 且 keyword 非空 → 通过白名单校验（不是 400 UNKNOWN_ACTION）', async () => {
    const r = await post({ action: 'open_search', keyword: '装修' });
    expect(r.status).toBe(200);
    expect(commandBridge.dispatchAndWait).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/__tests__/devices.test.ts -t "open_search"`
Expected: FAIL（400 UNKNOWN_ACTION，因为白名单还没加）

- [ ] **Step 3: 实现**

`devices.ts:31-33` 改：
```typescript
const ACTION_WHITELIST = new Set([
  'screenshot', 'tap', 'swipe', 'type', 'key', 'launch', 'device_info', 'tree_dump', 'open_search',
]);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/__tests__/devices.test.ts`
Expected: PASS（全部，含新增用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/devices.ts apps/api/src/routes/__tests__/devices.test.ts
git commit -m "feat(api): devices路由ACTION_WHITELIST加入open_search"
```

---

## Task 6: `phonectl.sh` — 新增 `open_search` action 分支

**Files:**
- Modify: `scripts/openclaw/phonectl.sh`

- [ ] **Step 1: 无独立单测文件（phonectl.sh 由 adb-controller-bridge.test.js 端到端覆盖，见 Task 7）——直接实现**

- [ ] **Step 2: 实现**

在 `phonectl.sh` 的 `case "$ACTION" in` 里（已确认 `type)` 分支实际写法为 `[ $# -ge 1 ] || die "type 需要 text"` → `ARGS_JSON=$(jq -n --arg t "$1" '{text:$t}')` → `shift 1`），紧跟着同风格新增 `open_search)` 分支（放在 `type)` 分支之后、`key)` 分支之前）：
```bash
  open_search)
    [ $# -ge 1 ] || die "open_search 需要 keyword"
    ARGS_JSON=$(jq -n --arg kw "$1" '{keyword:$kw}')
    shift 1
    ;;
```

- [ ] **Step 3: 手动验证语法**

Run: `bash -n scripts/openclaw/phonectl.sh`
Expected: 无输出（语法正确）

- [ ] **Step 4: Commit**

```bash
git add scripts/openclaw/phonectl.sh
git commit -m "feat(openclaw): phonectl.sh新增open_search action分支"
```

---

## Task 7: `adb-controller-bridge.sh` — 新增 `open-search-evidence` 命令 + command-trace 留痕

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh`
- Test: `scripts/openclaw/__tests__/adb-controller-bridge.test.js`

- [ ] **Step 1: 写失败测试**

在 `adb-controller-bridge.test.js` 里参照 `open-app` 测试片段（约在文件中段，`open-app：调用 phonectl launch 抖音包名` 测试附近）新增：

```js
test('open-search-evidence：调用 phonectl open_search 并落盘证据', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    let capturedBody = null;
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]).toString('base64');
    server = await startMockServer((req, res, body) => {
      capturedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', data: { imageBase64: fakeImage } } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'open-search-evidence', '装修', 'search.s1.screen1'], {
      PROFILES_FILE: profilesFile, ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    assert.equal(capturedBody.action, 'open_search');
    assert.equal(capturedBody.keyword, '装修');
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.action_ok, true);
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open-search-evidence：缺 keyword 参数报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  try {
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['--profile', 'test-profile', 'open-search-evidence'], {
      PROFILES_FILE: profilesFile,
    });
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('command-trace：调用命令后追加一行到 <profile>.command-trace.jsonl', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res, body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme' } }));
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'open-app'], {
      PROFILES_FILE: profilesFile, ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
      COMMAND_TRACE_DIR: dir,
    });
    assert.equal(r.status, 0);
    const traceContent = readFileSync(join(dir, 'test-profile.command-trace.jsonl'), 'utf8');
    const lines = traceContent.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.command, 'open-app');
    assert.ok(entry.ts);

    // 第二次调用（无 evidence_id 的 preflight 类命令也要能留痕，验证不依赖 evidence_id 位置）：
    const r2 = await runBridge(['--profile', 'test-profile', 'back-evidence', 'search.s1.screen2'], {
      PROFILES_FILE: profilesFile, ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
      COMMAND_TRACE_DIR: dir,
    });
    assert.equal(r2.status, 0);
    const traceContent2 = readFileSync(join(dir, 'test-profile.command-trace.jsonl'), 'utf8');
    const lines2 = traceContent2.trim().split('\n').filter(Boolean);
    assert.equal(lines2.length, 2);
    assert.equal(JSON.parse(lines2[1]).command, 'back-evidence');
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

确认文件顶部已 `import { readFileSync } from 'node:fs'`（若没有则加上；比照文件顶部现有 `import { mkdtempSync, rmSync } from 'node:fs'` 风格合并到同一条 import）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: FAIL（`open-search-evidence` 命令不存在走 `cmd_unsupported`，command-trace 文件不存在）

- [ ] **Step 3: 实现**

在 `adb-controller-bridge.sh` 里 `cmd_swipe_evidence`/`cmd_back_evidence` 附近（紧邻的既有 `*_evidence` 命令函数群，`case "$COMMAND" in` 之前）新增：

```bash
cmd_open_search_evidence() {
  local keyword="${1:-}" evidence_id="${2:-}" wait_ms="${3:-800}"
  [ -n "$keyword" ] && [ -n "$evidence_id" ] || die "open-search-evidence 需要 keyword evidence_id [wait_ms]"
  validate_evidence_id "$evidence_id"
  call_phonectl open_search "$keyword"
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(extract_phonectl_error "OPEN_SEARCH_FAILED" "打开搜索失败")" 1
  fi
  finish_action_evidence "$evidence_id" "$wait_ms"
}
```

（`call_phonectl open_search "$keyword"` 位置参数传递方式已核对与 `cmd_swipe_evidence` 的 `call_phonectl swipe "$x1" "$y1" "$x2" "$y2" "$duration_ms"` 一致，且与 Task 6 `phonectl.sh` 里 `open_search)` 分支读 `$1` 的方式对齐。）

紧接着在 `cmd_unsupported()` 函数定义之后插入 command-trace 留痕逻辑（**在 `case "$COMMAND" in` 这一行之前**）：

```bash
# ── command-trace 留痕（为将来蒸馏铺路，见设计文档"决策5"）──────────────────
# 分桶键用 $PROFILE（脚本入口已校验 ^[A-Za-z0-9_-]+$、每次调用必然存在），不用
# evidence_id——validate_evidence_id 的正则不允许冒号，且 evidence_id 在不同命令里
# 的参数位置并不固定（tap-evidence 是第3位，back-evidence 是第1位），没有稳定可提取的位置。
jq -nc --arg cmd "$COMMAND" --arg args "$*" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{command:$cmd, args:$args, ts:$ts}' >> "${COMMAND_TRACE_DIR:-/tmp}/${PROFILE}.command-trace.jsonl" 2>/dev/null || true
```

然后是最外层 `case "$COMMAND" in`（`adb-controller-bridge.sh:402-416` 附近）新增一行（放在 `tap-evidence)` 分支附近）：
```bash
  open-search-evidence) cmd_open_search_evidence "$@" ;;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: PASS（全部，含新增 3 条）

- [ ] **Step 5: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "feat(openclaw): adb-controller-bridge.sh新增open-search-evidence命令+command-trace留痕"
```

---

## Task 8: HK-VPS 部署同步

**Files:** 无仓库内文件改动（运维部署步骤）

- [ ] **Step 1**：确认 CI 全绿、PR 已合并（走 finishing-a-development-branch → engine-ship → engine-pr-watchdog 收尾流程后自动到达此状态）

- [ ] **Step 2**：SSH 到 hk-vps，把仓库最新 `scripts/openclaw/adb-controller-bridge.sh` 和 `scripts/openclaw/phonectl.sh` 同步部署到 `/opt/openclaw/zenithjoy-bridge/scripts/`（**必须做**——本 sprint 的 call_state 修复曾因漏做这步导致真机验证读到旧代码，见 `docs/handoffs/202609061020-callstate-detection.md`"过程中的重要教训"一节）：

```bash
ssh hk-vps "cd /path/to/zenithjoy-workspace-checkout && git fetch origin main && git checkout origin/main -- scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/phonectl.sh"
ssh hk-vps "cp /path/to/zenithjoy-workspace-checkout/scripts/openclaw/adb-controller-bridge.sh /opt/openclaw/zenithjoy-bridge/scripts/adb-controller-bridge.sh"
ssh hk-vps "cp /path/to/zenithjoy-workspace-checkout/scripts/openclaw/phonectl.sh /opt/openclaw/zenithjoy-bridge/scripts/phonectl.sh"
```

（具体仓库 checkout 路径以 hk-vps 上实际存在的路径为准，先 `ssh hk-vps "find / -maxdepth 4 -iname 'adb-controller-bridge.sh' 2>/dev/null"` 定位。）

- [ ] **Step 3**：agent-android 新版本需要走正常 OTA 流程升级到测试机（参照本 sprint call_state 那次的 OTA 部署方式）

---

## Task 9: 真机 E2E 验证

**Files:** 无仓库内文件改动（验证步骤）

- [ ] **Step 1**：确认测试机（HONOR MAA-AN00）无障碍服务已绑定、MediaProjection 截屏已授权（本 sprint 前几轮已验证过，若重新覆盖安装需要重新走一遍 adb 恢复流程）

- [ ] **Step 2**：调用新命令：
```bash
ssh hk-vps "bash /opt/openclaw/zenithjoy-bridge/scripts/adb-controller-bridge.sh --profile <test-profile> open-search-evidence 装修 verify:s1:screen1"
```
Expected: `{"ok":true, "action_ok":true, ...}`，落盘的截图证据里搜索框显示"装修"且已进入搜索结果页（人工核对截图内容）

- [ ] **Step 3**：确认 command-trace 文件在 hk-vps 上按预期落盘（`${COMMAND_TRACE_DIR}/verify.command-trace.jsonl` 含这次调用记录）

- [ ] **Step 4**：触发一次完整的 discovery 阶段真机运行（参照本 sprint 之前 `social-keyword-leadgen-*` 的触发方式），确认不再报"controller lacks the required open-search entrypoint"，discovery 阶段能推进到下一步（视频筛选/翻页）

---

完成以上 9 个 Task 后，走 `superpowers:finishing-a-development-branch`（Option 2 push+PR）→ `engine-ship` → `engine-pr-watchdog` 标准收尾流程。
