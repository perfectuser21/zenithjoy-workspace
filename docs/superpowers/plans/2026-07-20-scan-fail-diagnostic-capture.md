# scan-fail-diagnostic-capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `DeviceAccountScanService` fails to open Douyin's account-switch panel (`OPEN_PANEL_FAILED`) or fails to read the account list from it (`READ_FAILED`), capture a screenshot and an accessibility-tree text summary at that moment, and include them in the result report so a developer can remotely diagnose why a specific customer's phone/Douyin-version combination fails — without needing physical access to that device.

**Architecture:** Reuse three pieces of existing infrastructure end-to-end: (1) the already-built `ScreenCaptureService`/`ScreenCaptureReal`/`MediaProjectionHolder` screenshot pipeline (same one `ContentJudgmentService` already uses), (2) a new tree-dump function modeled on `DouyinCollectService.dumpNodeDescs`'s field set but returning a `String` instead of only logging, (3) the same base64-in-JSON upload pattern `ContentJudgmentService` already uses to send screenshots to the server. Only failure paths pay the capture cost; success paths are untouched.

**Tech Stack:** Kotlin (Android), TypeScript/Express (API), JUnit, Vitest.

## Global Constraints

- TDD 铁律：每个 task 先写失败测试（commit-1），再写实现让测试变绿（commit-2）
- 不改 `openSwitchAccountPanel`/`readAccountListFromPanel` 的坐标自动化逻辑本身——本次只加诊断能力，不碰"猜坐标"那部分
- 只在失败路径（`errorCode` 非空）触发截图/树摘要捕获，成功路径零额外开销
- 截图/未授权 MediaProjection 时返回 `null`，必须优雅降级为"无截图但仍正常上报"，不得阻塞既有失败上报流程

---

### Task 1: 无障碍树摘要 dump 函数

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceTreeDumpTest.kt`（新建）

**⚠️ 环境约束（已核实，非推测）**：`services/agent-android/app/build.gradle.kts` 的 `testImplementation` 只有 `libs.junit`/`libs.mockwebserver`/`libs.kotlinx.coroutines.test`——**没有 Mockito、没有 Robolectric**。`AccessibilityNodeInfo` 是 Android 框架类，纯 JVM 单测环境下直接 `mock()`/构造真实实例都不可行。必须照抄本仓库已有的可测试性写法——`ScreenCaptureService`（`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ScreenCaptureService.kt`）用「注入 lambda」把真实 Android 实现和纯逻辑分离，本 task 用同样思路：把"遍历+过滤+格式化"这部分逻辑抽成对泛型 `T` 操作的纯函数（用普通 Kotlin 对象即可单测，不碰 Android SDK），真实的 `dumpNodeTreeAsString(root: AccessibilityNodeInfo?, ...)` 只是一层薄适配。

**Interfaces:**
- Produces：
  - `fun <T> dumpNodesGeneric(root: T?, limit: Int, getClassName: (T) -> String, getText: (T) -> String?, getContentDesc: (T) -> String?, getClickable: (T) -> Boolean, getBoundsWH: (T) -> Pair<Int, Int>, getChildCount: (T) -> Int, getChild: (T, Int) -> T?): String`（纯函数，无 Android 依赖，单测目标）
  - `fun dumpNodeTreeAsString(root: AccessibilityNodeInfo?, limit: Int = 80): String`（真实适配层，调用上面的泛型函数，供 Task 2 调用）

- [ ] **Step 1: 写失败测试 — 新建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceTreeDumpTest.kt`**

```kotlin
package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * dumpNodesGeneric：无障碍树摘要 dump 的纯逻辑核心（sprint 07201209，账号扫描失败诊断）。
 * 用普通 Kotlin 测试对象代替 AccessibilityNodeInfo——本仓库测试环境无 Mockito/Robolectric，
 * 无法 mock Android 框架类，照抄 ScreenCaptureService 的"注入 lambda 分离纯逻辑"写法。
 */
class DeviceAccountScanServiceTreeDumpTest {

    /** 测试专用的极简树节点，不依赖任何 Android 类型。 */
    data class FakeNode(
        val className: String = "android.widget.TextView",
        val text: String? = null,
        val contentDesc: String? = null,
        val clickable: Boolean = false,
        val boundsWH: Pair<Int, Int> = 0 to 0,
        val children: List<FakeNode> = emptyList(),
    )

    private fun dump(root: FakeNode?, limit: Int = 80): String = dumpNodesGeneric(
        root = root,
        limit = limit,
        getClassName = { it.className },
        getText = { it.text },
        getContentDesc = { it.contentDesc },
        getClickable = { it.clickable },
        getBoundsWH = { it.boundsWH },
        getChildCount = { it.children.size },
        getChild = { node, i -> node.children.getOrNull(i) },
    )

    @Test
    fun `root为null时返回占位字符串不崩溃`() {
        val result = dump(null)
        assertTrue(result.contains("root=null"))
    }

    @Test
    fun `有意义节点(有文字或可点击)会出现在输出里，纯空节点不占行`() {
        val leaf1 = FakeNode(text = "切换账号", clickable = true)
        val leaf2 = FakeNode() // 无文字、无描述、不可点击 —— 应被跳过
        val root = FakeNode(className = "android.widget.FrameLayout", children = listOf(leaf1, leaf2))

        val result = dump(root)

        assertTrue(result.contains("切换账号"))
        assertTrue(result.contains("click=true"))
        // 只有 1 个有意义节点被打印（root 本身无文字/不可点击也被跳过，leaf2 也跳过）
        assertEquals(1, result.lines().count { it.contains("#") })
    }

    @Test
    fun `超过limit则停止遍历`() {
        val children = (1..100).map { FakeNode(text = "node$it", clickable = true) }
        val root = FakeNode(children = children)

        val result = dump(root, limit = 5)

        assertTrue(result.contains("printed=5"))
    }
}
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceTreeDumpTest"`
Expected: FAIL（`dumpNodesGeneric` unresolved reference，编译失败）

- [ ] **Step 3: 实现 — 在 `DeviceAccountScanService.kt` 里新增两个函数（放在类内，跟其它无障碍操作函数放一起，如 `openSwitchAccountPanel` 附近；`dumpNodesGeneric` 可以是顶层函数或 companion object 内均可，保持跟文件里其它 private helper 一致的位置习惯）**

```kotlin
    /**
     * 无障碍树摘要 dump 的纯逻辑核心，对泛型 T 操作，不碰 Android SDK——JVM 单测环境
     * 无 Mockito/Robolectric，用这个把可测的核心逻辑和真实 AccessibilityNodeInfo 遍历分离
     * （sprint 07201209，账号扫描失败诊断，同 ScreenCaptureService 的注入 lambda 写法）。
     */
    fun <T> dumpNodesGeneric(
        root: T?,
        limit: Int,
        getClassName: (T) -> String,
        getText: (T) -> String?,
        getContentDesc: (T) -> String?,
        getClickable: (T) -> Boolean,
        getBoundsWH: (T) -> Pair<Int, Int>,
        getChildCount: (T) -> Int,
        getChild: (T, Int) -> T?,
    ): String {
        if (root == null) return "DUMP root=null"
        val sb = StringBuilder()
        val queue = ArrayDeque<T>()
        queue.add(root)
        var n = 0
        while (queue.isNotEmpty() && n < limit) {
            val node = queue.removeFirst()
            val (w, h) = getBoundsWH(node)
            val desc = getContentDesc(node)?.take(40)
            val txt = getText(node)?.take(40)
            val clickable = getClickable(node)
            if (!desc.isNullOrBlank() || !txt.isNullOrBlank() || clickable) {
                sb.appendLine("#$n cls=${getClassName(node)} click=$clickable b=${w}x${h} desc=$desc txt=$txt")
                n++
            }
            for (i in 0 until getChildCount(node)) getChild(node, i)?.let { queue.add(it) }
        }
        sb.appendLine("end printed=$n")
        return sb.toString()
    }

    /** 真实 AccessibilityNodeInfo 适配层，调用上面的纯逻辑核心。供 Task 2 在失败路径调用。 */
    fun dumpNodeTreeAsString(root: AccessibilityNodeInfo?, limit: Int = 80): String = dumpNodesGeneric(
        root = root,
        limit = limit,
        getClassName = { it.className?.toString() ?: "" },
        getText = { it.text?.toString() },
        getContentDesc = { it.contentDescription?.toString() },
        getClickable = { it.isClickable },
        getBoundsWH = { node -> val b = Rect(); node.getBoundsInScreen(b); b.width() to b.height() },
        getChildCount = { it.childCount },
        getChild = { node, i -> node.getChild(i) },
    )
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceTreeDumpTest"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceTreeDumpTest.kt
git commit -m "test(android): add failing tests for dumpNodesGeneric tree-dump core logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "feat(android): 新增无障碍树摘要dump函数(纯逻辑核心+真实适配层)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 截图+树摘要接入失败路径，广播新增字段

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceBroadcastTest.kt`（新建，若创建 Intent 相关测试在纯 JVM 环境不可行，改为对 Task 1 函数的调用点做静态代码检查测试，见 Step 1 说明）

**Interfaces:**
- Consumes：Task 1 的 `dumpNodeTreeAsString`（已存在）；已有的 `ScreenCaptureService`（`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ScreenCaptureService.kt`）、`ScreenCaptureReal.buildCaptureImpl`（`ScreenCaptureReal.kt:57`）、`MediaProjectionHolder.getOrCreateProjection`（`MediaProjectionHolder.kt:84`）
- Produces：`sendScanResultBroadcast` 新增两个可选参数 `screenshotB64: String? = null`、`treeDump: String? = null`；新增两个 Intent extra 常量 `EXTRA_SCREENSHOT_B64`、`EXTRA_TREE_DUMP`，供 Task 3 消费

**当前 `sendScanResultBroadcast` 完整代码（`DeviceAccountScanService.kt:613-624`）：**

```kotlin
    private fun sendScanResultBroadcast(requestId: String, ok: Boolean, stale: Boolean, accountIds: List<String>, errorCode: String) {
        val intent = Intent(ACTION_ACCOUNT_SCAN_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_RESULT_OK, ok)
            putExtra(EXTRA_RESULT_STALE, stale)
            putExtra(EXTRA_RESULT_ACCOUNT_IDS, accountIds.toTypedArray())
            putExtra(EXTRA_ERROR, errorCode)
        }
        sendBroadcast(intent)
        android.util.Log.i(TAG, "account scan result broadcast: requestId=$requestId ok=$ok stale=$stale accounts=${accountIds.size} error=$errorCode")
    }
```

**当前 EXTRA 常量声明区（`DeviceAccountScanService.kt:634-641`，companion object 内）：**

```kotlin
        const val ACTION_ACCOUNT_SCAN_TASK = "com.zenithjoy.agent.ACCOUNT_SCAN_TASK"
        const val ACTION_ACCOUNT_SCAN_RESULT = "com.zenithjoy.agent.ACCOUNT_SCAN_RESULT"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_TENANT_ID = "tenant_id"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_RESULT_OK = "result_ok"
        const val EXTRA_RESULT_STALE = "result_stale"
        const val EXTRA_RESULT_ACCOUNT_IDS = "result_account_ids"
        const val EXTRA_ERROR = "error"
```

**当前两个失败调用点（`DeviceAccountScanService.kt` 内 `runScanSequence`）：**

```kotlin
    private suspend fun runScanSequence(requestId: String, tenantId: String, thisDeviceId: String) {
        val opened = openSwitchAccountPanel()
        if (!opened) {
            val resolution = resolveAccountsToPersist(
                readSucceeded = false,
                previousKnownIds = DeviceAccountRegistry.snapshot().keys.toList(),
                freshlyScannedRawIds = emptyList(),
            )
            sendScanResultBroadcast(requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = "OPEN_PANEL_FAILED")
            return
        }

        state = State.READING_ACCOUNT_LIST
        val rawIds = readAccountListFromPanel()
        val readSucceeded = rawIds != null
        // ... (省略中间的账号处理逻辑，本 task 不改)

        sendScanResultBroadcast(requestId, ok = readSucceeded, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = if (readSucceeded) "" else "READ_FAILED")

        state = State.CLOSING_SWITCH_ACCOUNT_PANEL
        closeSwitchAccountPanel()
    }
```

- [ ] **Step 1: 写失败测试**

由于截图/无障碍树捕获涉及真实 `Context`/`MediaProjection`，无法在纯 JVM 单测里验证端到端行为。改为静态代码断言测试（同项目里 `dm-dispatch-cron` sprint 用过的模式）——新建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceBroadcastTest.kt`：

```kotlin
package com.zenithjoy.agent.account

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 静态检查：确认失败路径真的接入了截图+树摘要捕获（不是只加了参数没调用）。
 * sprint 07201209。
 */
class DeviceAccountScanServiceBroadcastTest {
    private val SOURCE_PATH = "src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt"

    @Test
    fun `sendScanResultBroadcast 含 screenshotB64 和 treeDump 参数`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue(src.contains("screenshotB64: String? = null"))
        assertTrue(src.contains("treeDump: String? = null"))
    }

    @Test
    fun `EXTRA_SCREENSHOT_B64 和 EXTRA_TREE_DUMP 已声明`() {
        val src = File(SOURCE_PATH).readText()
        assertTrue(src.contains("EXTRA_SCREENSHOT_B64"))
        assertTrue(src.contains("EXTRA_TREE_DUMP"))
    }

    @Test
    fun `OPEN_PANEL_FAILED 和 READ_FAILED 调用点都传了 screenshotB64/treeDump（不是只声明参数没实际调用）`() {
        val src = File(SOURCE_PATH).readText()
        val openPanelFailedCallSite = src.substringAfter("errorCode = \"OPEN_PANEL_FAILED\"").substringBefore("return")
        // errorCode = "OPEN_PANEL_FAILED" 本身在调用参数列表里，往前找该行的调用语句
        val fullCallLine = src.lines().firstOrNull { it.contains("errorCode = \"OPEN_PANEL_FAILED\"") } ?: ""
        assertTrue("OPEN_PANEL_FAILED 调用点应传 screenshotB64", fullCallLine.contains("screenshotB64"))
        val readFailedLine = src.lines().firstOrNull { it.contains("if (readSucceeded) \"\" else \"READ_FAILED\"") } ?: ""
        assertTrue("READ_FAILED 调用点应传 screenshotB64", readFailedLine.contains("screenshotB64"))
    }
}
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceBroadcastTest"`
Expected: 3 个用例全部 FAIL（当前代码没有这些字段/参数）

- [ ] **Step 3: 实现**

在 EXTRA 常量声明区（`EXTRA_ERROR` 之后）追加：

```kotlin
        const val EXTRA_SCREENSHOT_B64 = "screenshot_b64"
        const val EXTRA_TREE_DUMP = "tree_dump"
```

新增一个私有捕获辅助函数（放在 `dumpNodeTreeAsString` 附近）：

```kotlin
    /**
     * 失败诊断捕获：截图（未授权/失败则 null，不阻塞上报）+ 当前无障碍树摘要。
     * 只在 OPEN_PANEL_FAILED/READ_FAILED 路径调用，成功路径不产生额外开销（sprint 07201209）。
     */
    private fun captureFailureDiagnostics(): Pair<String?, String?> {
        val screenshot = try {
            ScreenCaptureService(
                ScreenCaptureReal.buildCaptureImpl(this) { MediaProjectionHolder.getOrCreateProjection(this) }
            ).captureToBase64()
        } catch (e: Exception) {
            android.util.Log.w(TAG, "failure screenshot capture threw: ${e.message}")
            null
        }
        val tree = try {
            dumpNodeTreeAsString(rootInActiveWindow)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "failure tree dump threw: ${e.message}")
            null
        }
        return screenshot to tree
    }
```

修改 `sendScanResultBroadcast` 签名与 body：

```kotlin
    private fun sendScanResultBroadcast(
        requestId: String, ok: Boolean, stale: Boolean, accountIds: List<String>, errorCode: String,
        screenshotB64: String? = null, treeDump: String? = null,
    ) {
        val intent = Intent(ACTION_ACCOUNT_SCAN_RESULT).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_RESULT_OK, ok)
            putExtra(EXTRA_RESULT_STALE, stale)
            putExtra(EXTRA_RESULT_ACCOUNT_IDS, accountIds.toTypedArray())
            putExtra(EXTRA_ERROR, errorCode)
            if (screenshotB64 != null) putExtra(EXTRA_SCREENSHOT_B64, screenshotB64)
            if (treeDump != null) putExtra(EXTRA_TREE_DUMP, treeDump)
        }
        sendBroadcast(intent)
        android.util.Log.i(TAG, "account scan result broadcast: requestId=$requestId ok=$ok stale=$stale accounts=${accountIds.size} error=$errorCode hasScreenshot=${screenshotB64 != null}")
    }
```

修改 `runScanSequence` 的两个失败调用点：

```kotlin
        val opened = openSwitchAccountPanel()
        if (!opened) {
            val resolution = resolveAccountsToPersist(
                readSucceeded = false,
                previousKnownIds = DeviceAccountRegistry.snapshot().keys.toList(),
                freshlyScannedRawIds = emptyList(),
            )
            val (screenshotB64, treeDump) = captureFailureDiagnostics()
            sendScanResultBroadcast(requestId, ok = false, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = "OPEN_PANEL_FAILED", screenshotB64 = screenshotB64, treeDump = treeDump)
            return
        }
```

（`readAccountListFromPanel` 之后原有的 `sendScanResultBroadcast(requestId, ok = readSucceeded, ...)` 调用改为：）

```kotlin
        val (screenshotB64, treeDump) = if (readSucceeded) null to null else captureFailureDiagnostics()
        sendScanResultBroadcast(requestId, ok = readSucceeded, stale = resolution.stale, accountIds = resolution.accountIds, errorCode = if (readSucceeded) "" else "READ_FAILED", screenshotB64 = screenshotB64, treeDump = treeDump)
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceBroadcastTest"`
Expected: 3 个用例全部 PASS

- [ ] **Step 5: 跑 Task 1 + 既有相关测试回归**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceTreeDumpTest" --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceBroadcastTest" --tests "com.zenithjoy.agent.AgentServiceAccountScanTest"`
Expected: 全部 PASS，无回归

- [ ] **Step 6: Commit**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceBroadcastTest.kt
git commit -m "test(android): add failing tests for screenshot/tree-dump wiring in failure broadcast

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "feat(android): 账号扫描失败时接入截图+树摘要捕获

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: AgentService 接收新字段并透传上报，服务端落库

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- Modify: `apps/api/src/routes/agent-burner.ts`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceAccountScanTest.kt`（追加用例）
- Test: `apps/api/src/routes/agent-burner.test.ts`（追加用例）

**Interfaces:**
- Consumes：Task 2 的 `EXTRA_SCREENSHOT_B64`/`EXTRA_TREE_DUMP`
- Produces：`buildAccountScanResultBody` 新增两个可选参数；`/account-scan-result` 服务端新增两个字段落库到 `publish_tasks.response`

**当前 `accountScanResultReceiver`（`AgentService.kt:104-115`）：**

```kotlin
    private val accountScanResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DeviceAccountScanService.ACTION_ACCOUNT_SCAN_RESULT) return
            val requestId = intent.getStringExtra(DeviceAccountScanService.EXTRA_REQUEST_ID) ?: ""
            val ok = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_OK, false)
            val stale = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_STALE, false)
            val accountIds = intent.getStringArrayExtra(DeviceAccountScanService.EXTRA_RESULT_ACCOUNT_IDS)?.toList() ?: emptyList()
            val errorCode = intent.getStringExtra(DeviceAccountScanService.EXTRA_ERROR) ?: ""
            scope.launch(Dispatchers.IO) { reportAccountScanResult(requestId, ok, stale, accountIds, errorCode) }
        }
    }
```

**当前 `reportAccountScanResult`（`AgentService.kt:684-706`附近）：**

```kotlin
    private fun reportAccountScanResult(
        requestId: String,
        ok: Boolean,
        stale: Boolean,
        accountIds: List<String>,
        errorCode: String,
    ) {
        val url = "${config.deriveHttpBase()}/api/agent/burner/account-scan-result"
        val body = buildAccountScanResultBody(requestId, config.agentId, ok, stale, accountIds, errorCode)
        try {
            val request = Request.Builder()
                .url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            httpClient.newCall(request).execute().use { resp ->
                android.util.Log.i(
                    TAG,
                    "account-scan-result reported: ${resp.code} requestId=$requestId accountCount=${accountIds.size}",
                )
            }
        } catch (e: Exception) {
            // ...（既有 catch，不改）
        }
    }
```

**当前 `buildAccountScanResultBody`（`AgentService.kt:1009-1024`，companion object 内）：**

```kotlin
        fun buildAccountScanResultBody(
            requestId: String,
            agentId: String,
            ok: Boolean,
            stale: Boolean,
            accountIds: List<String>,
            errorCode: String,
        ): String {
            fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")
            val ids = accountIds.joinToString(",") { "\"${esc(it)}\"" }
            return "{\"request_id\":\"${esc(requestId)}\"," +
                "\"agent_id\":\"${esc(agentId)}\"," +
                "\"ok\":$ok,\"stale\":$stale," +
                "\"account_ids\":[$ids]," +
                "\"error_code\":\"${esc(errorCode)}\"}"
        }
```

**当前 `apps/api/src/routes/agent-burner.ts` 的 `/account-scan-result`（关键片段，完整已在本任务 brief 里给出）：**

```typescript
router.post('/account-scan-result', async (req: Request, res: Response) => {
  const { agent_id, request_id, ok, account_ids, error_code } = req.body || {};
  // ...（省略 UUID 校验+session写入逻辑，本 task 不改）
  if (taskFound) {
    const taskStatus = ok === true ? 'done' : 'failed';
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status=$2, response=$3::jsonb, updated_at=NOW() WHERE id=$1`,
      [
        request_id,
        taskStatus,
        JSON.stringify({
          ok: !!ok,
          account_ids: ids,
          error_code: typeof error_code === 'string' ? error_code : null,
        }),
      ],
    );
  }
  return res.json(OK({ written }));
});
```

- [ ] **Step 1: 写失败测试（Android 部分）— 追加到 `AgentServiceAccountScanTest.kt`**

```kotlin
    @Test
    fun builds_account_scan_result_body_with_screenshot_and_tree_dump_when_present() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "OPEN_PANEL_FAILED",
            screenshotB64 = "ZmFrZWJhc2U2NA==", treeDump = "line1\nline2",
        )
        assertTrue(body.contains("\"screenshot_b64\":\"ZmFrZWJhc2U2NA==\""))
        assertTrue(body.contains("\"tree_dump\""))
        assertTrue(body.contains("line1"))
    }

    @Test
    fun builds_account_scan_result_body_without_screenshot_fields_when_null() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "req2", agentId = "a1", ok = true, stale = false,
            accountIds = listOf("大湖"), errorCode = "",
            screenshotB64 = null, treeDump = null,
        )
        assertTrue(body.contains("\"screenshot_b64\":null"))
        assertTrue(body.contains("\"tree_dump\":null"))
    }

    @Test
    fun escapes_newlines_and_quotes_in_tree_dump() {
        val body = AgentService.buildAccountScanResultBody(
            requestId = "r1", agentId = "a1", ok = false, stale = false,
            accountIds = emptyList(), errorCode = "READ_FAILED",
            screenshotB64 = null, treeDump = "desc=\"切换账号\"\nline2",
        )
        // 必须是合法 JSON——换行符和引号都要转义，不能原样嵌进字符串字面量把 JSON 打断
        assertTrue(body.contains("\\n"))
        assertTrue(body.contains("\\\""))
    }
```

- [ ] **Step 2: 跑测试确认报红（Android 部分）**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceAccountScanTest"`
Expected: 新增 3 个用例 FAIL（`buildAccountScanResultBody` 还没有 `screenshotB64`/`treeDump` 参数，编译失败），原有 3 个用例（`builds_account_scan_result_body_with_fields_and_ids` 等）也会因编译失败连带报错——这是预期的，实现后一起转绿

- [ ] **Step 3: 写失败测试（API 部分）— 追加到 `apps/api/src/routes/agent-burner.test.ts` 的 `describe('POST /account-scan-result...')` 块**

```typescript
  it('screenshot_b64/tree_dump 存在 → response 落库带上这两个字段', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: TASK_UUID,
        ok: false,
        account_ids: [],
        error_code: 'OPEN_PANEL_FAILED',
        screenshot_b64: 'ZmFrZWJhc2U2NA==',
        tree_dump: 'line1\nline2',
      });

    expect(r.status).toBe(200);
    const calls = vi.mocked(pool.query).mock.calls;
    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.publish_tasks/i.test(String(c[0])));
    expect(updateCall).toBeTruthy();
    const responseJson = JSON.parse(updateCall![1][2] as string);
    expect(responseJson.screenshot_b64).toBe('ZmFrZWJhc2U2NA==');
    expect(responseJson.tree_dump).toBe('line1\nline2');
  });

  it('screenshot_b64/tree_dump 缺失时 response 里对应字段为 null，不报错', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ agent_id: AGENT_UUID, request_id: TASK_UUID, ok: true, account_ids: ['大湖'] });

    expect(r.status).toBe(200);
    const calls = vi.mocked(pool.query).mock.calls;
    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.publish_tasks/i.test(String(c[0])));
    const responseJson = JSON.parse(updateCall![1][2] as string);
    expect(responseJson.screenshot_b64).toBeNull();
    expect(responseJson.tree_dump).toBeNull();
  });
```

- [ ] **Step 4: 跑测试确认报红（API 部分）**

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts -t "screenshot_b64"`
Expected: 2 个用例 FAIL（当前 response JSON 不含这两个字段，`responseJson.screenshot_b64` 是 `undefined` 不是预期值）

- [ ] **Step 5: 实现**

`AgentService.kt`：修改 `accountScanResultReceiver`：

```kotlin
    private val accountScanResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DeviceAccountScanService.ACTION_ACCOUNT_SCAN_RESULT) return
            val requestId = intent.getStringExtra(DeviceAccountScanService.EXTRA_REQUEST_ID) ?: ""
            val ok = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_OK, false)
            val stale = intent.getBooleanExtra(DeviceAccountScanService.EXTRA_RESULT_STALE, false)
            val accountIds = intent.getStringArrayExtra(DeviceAccountScanService.EXTRA_RESULT_ACCOUNT_IDS)?.toList() ?: emptyList()
            val errorCode = intent.getStringExtra(DeviceAccountScanService.EXTRA_ERROR) ?: ""
            val screenshotB64 = intent.getStringExtra(DeviceAccountScanService.EXTRA_SCREENSHOT_B64)
            val treeDump = intent.getStringExtra(DeviceAccountScanService.EXTRA_TREE_DUMP)
            scope.launch(Dispatchers.IO) { reportAccountScanResult(requestId, ok, stale, accountIds, errorCode, screenshotB64, treeDump) }
        }
    }
```

修改 `reportAccountScanResult` 签名（追加两个可选参数并透传）：

```kotlin
    private fun reportAccountScanResult(
        requestId: String,
        ok: Boolean,
        stale: Boolean,
        accountIds: List<String>,
        errorCode: String,
        screenshotB64: String? = null,
        treeDump: String? = null,
    ) {
        val url = "${config.deriveHttpBase()}/api/agent/burner/account-scan-result"
        val body = buildAccountScanResultBody(requestId, config.agentId, ok, stale, accountIds, errorCode, screenshotB64, treeDump)
        // ...（其余不变）
    }
```

修改 `buildAccountScanResultBody`（追加两个可选参数，JSON 里加两个字段，用 `esc()` 处理换行——`esc` 目前只转义反斜杠和双引号，JSON 字符串里的原始换行符本身也是非法的，必须追加转义）：

```kotlin
        fun buildAccountScanResultBody(
            requestId: String,
            agentId: String,
            ok: Boolean,
            stale: Boolean,
            accountIds: List<String>,
            errorCode: String,
            screenshotB64: String? = null,
            treeDump: String? = null,
        ): String {
            fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
            val ids = accountIds.joinToString(",") { "\"${esc(it)}\"" }
            val screenshotField = if (screenshotB64 != null) "\"${esc(screenshotB64)}\"" else "null"
            val treeDumpField = if (treeDump != null) "\"${esc(treeDump)}\"" else "null"
            return "{\"request_id\":\"${esc(requestId)}\"," +
                "\"agent_id\":\"${esc(agentId)}\"," +
                "\"ok\":$ok,\"stale\":$stale," +
                "\"account_ids\":[$ids]," +
                "\"error_code\":\"${esc(errorCode)}\"," +
                "\"screenshot_b64\":$screenshotField," +
                "\"tree_dump\":$treeDumpField}"
        }
```

`apps/api/src/routes/agent-burner.ts`：修改 `/account-scan-result` 解构+落库：

```typescript
router.post('/account-scan-result', async (req: Request, res: Response) => {
  const { agent_id, request_id, ok, account_ids, error_code, screenshot_b64, tree_dump } = req.body || {};
  // ...（省略不变部分）
  if (taskFound) {
    const taskStatus = ok === true ? 'done' : 'failed';
    await pool.query(
      `UPDATE zenithjoy.publish_tasks SET status=$2, response=$3::jsonb, updated_at=NOW() WHERE id=$1`,
      [
        request_id,
        taskStatus,
        JSON.stringify({
          ok: !!ok,
          account_ids: ids,
          error_code: typeof error_code === 'string' ? error_code : null,
          screenshot_b64: typeof screenshot_b64 === 'string' ? screenshot_b64 : null,
          tree_dump: typeof tree_dump === 'string' ? tree_dump : null,
        }),
      ],
    );
  }
  return res.json(OK({ written }));
});
```

- [ ] **Step 6: 跑测试确认变绿**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceAccountScanTest"`
Expected: 6 个用例（原有3 + 新增3）全部 PASS

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts -t "screenshot_b64"`
Expected: 2 个用例 PASS

- [ ] **Step 7: 全量回归**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceTreeDumpTest" --tests "com.zenithjoy.agent.account.DeviceAccountScanServiceBroadcastTest" --tests "com.zenithjoy.agent.AgentServiceAccountScanTest"`
Expected: 全部 PASS

Run: `cd apps/api && npx vitest run src/routes/agent-burner.test.ts src/routes/agent-burner-warmup.test.ts`
Expected: 全部 PASS，无回归

Run: `cd apps/api && npx tsc --noEmit -p .`
Expected: 无报错

- [ ] **Step 8: Commit（Android 与 API 分开两组 test-first/impl commit，共4次）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceAccountScanTest.kt
git commit -m "test(android): add failing tests for buildAccountScanResultBody screenshot/tree_dump fields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
git commit -m "feat(android): AgentService透传截图+树摘要到account-scan-result上报

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add apps/api/src/routes/agent-burner.test.ts
git commit -m "test(agent-burner): add failing tests for screenshot_b64/tree_dump persistence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add apps/api/src/routes/agent-burner.ts
git commit -m "feat(agent-burner): account-scan-result落库screenshot_b64/tree_dump

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
