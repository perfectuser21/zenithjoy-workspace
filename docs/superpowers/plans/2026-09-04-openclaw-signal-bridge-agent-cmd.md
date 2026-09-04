# OpenClaw 信号桥·件1：agent-android 统一指令处理器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中台经现有 WS 通道下发 8 种结构化指令（screenshot/tap/swipe/type/key/launch/device_info/tree_dump），设备执行并回传带可区分错误码的结构化回执。

**Architecture:** 新增 `com.zenithjoy.agent.command` 包（协议解析→有界队列串行消费→执行器分发到各原语 Runner），全部依赖经注入 lambda 抽象（仓库 NodeAwaitTest 先例），纯 JVM 单测。既有代码只动三处：WsClient（msgId 透传/sendResult/busy 探针/token 日志脱敏）、AgentService（cmd 路由+接线）、三个无障碍服务 5 个任务入口（lease 拒单守卫）。

**Tech Stack:** Kotlin / kotlinx-coroutines / Gson / JUnit4（纯 JVM，无 Robolectric）。构建：`cd services/agent-android && ./gradlew :app:testDebugUnitTest`。本机若无 Android SDK 则以 CI（android-agent-ci.yml）跑测为准。

**设计文档:** `docs/superpowers/specs/2026-09-04-openclaw-signal-bridge-agent-cmd-design.md`（含 Research 修正笔记 7 条，实现以笔记为准）

**约定（全计划共用）:**
- 所有新 main 文件在 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/`
- 所有新测试在 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/`
- 测试命令：`cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.command.*" 2>&1 | tail -20`
- 每个 Task 两个 commit：先 failing test（红），后实现（绿）

---

### Task 1: CommandProtocol（解析/校验/回执构造 + 错误码表）

**Files:**
- Create: `.../command/CommandProtocol.kt`
- Test: `.../command/CommandProtocolTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package com.zenithjoy.agent.command

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandProtocolTest {
    private val SW = 1080
    private val SH = 2400

    @Test fun `tap 合法坐标解析成功`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to 540.0, "y" to 1200.0), SW, SH)
        r as ParseOutcome.Ok
        assertEquals(CmdAction.TAP, r.request.action)
        assertEquals(540, r.request.args["x"])
    }

    @Test fun `tap 负坐标拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to -5.0, "y" to 10.0), SW, SH)
        r as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_COORD_OUT_OF_BOUNDS, r.code)
    }

    @Test fun `tap 超出屏幕拒绝`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "tap", "x" to 1080.0, "y" to 10.0), SW, SH)
        assertTrue(r is ParseOutcome.Err)
    }

    @Test fun `swipe durationMs 缺省300并夹逼到50-10000`() {
        val ok = CommandProtocol.parse("m1", mapOf("action" to "swipe", "x1" to 1.0, "y1" to 1.0, "x2" to 2.0, "y2" to 2.0), SW, SH) as ParseOutcome.Ok
        assertEquals(300L, ok.request.args["durationMs"])
        val clamped = CommandProtocol.parse("m1", mapOf("action" to "swipe", "x1" to 1.0, "y1" to 1.0, "x2" to 2.0, "y2" to 2.0, "durationMs" to 999999.0), SW, SH) as ParseOutcome.Ok
        assertEquals(10000L, clamped.request.args["durationMs"])
    }

    @Test fun `未知 action 报 UNKNOWN_ACTION`() {
        val r = CommandProtocol.parse("m1", mapOf("action" to "fly"), SW, SH) as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_UNKNOWN_ACTION, r.code)
    }

    @Test fun `缺 msgId 报 BAD_REQUEST`() {
        val r = CommandProtocol.parse(null, mapOf("action" to "tap", "x" to 1.0, "y" to 1.0), SW, SH) as ParseOutcome.Err
        assertEquals(CommandProtocol.ERR_BAD_REQUEST, r.code)
    }

    @Test fun `key 只认 back home`() {
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "key", "name" to "back"), SW, SH) is ParseOutcome.Ok)
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "key", "name" to "menu"), SW, SH) is ParseOutcome.Err)
    }

    @Test fun `type 需要 text 字段`() {
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "type"), SW, SH) is ParseOutcome.Err)
        assertTrue(CommandProtocol.parse("m1", mapOf("action" to "type", "text" to "hi"), SW, SH) is ParseOutcome.Ok)
    }

    @Test fun `buildResult 带 inReplyTo ok errorCode foregroundPkg data`() {
        val m = CommandProtocol.buildResult("m1", CmdOutcome(false, CommandProtocol.ERR_QUEUE_FULL), "com.x")
        assertEquals("m1", m["inReplyTo"]); assertEquals(false, m["ok"])
        assertEquals(CommandProtocol.ERR_QUEUE_FULL, m["errorCode"]); assertEquals("com.x", m["foregroundPkg"])
    }
}
```

- [ ] **Step 2: Run test，确认编译失败（类不存在）**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandProtocolTest" 2>&1 | tail -5`
Expected: FAIL（Unresolved reference: CommandProtocol）

- [ ] **Step 3: Commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandProtocolTest.kt
git commit -m "test(agent-cmd): CommandProtocol 解析/校验/回执 failing tests（红）"
```

- [ ] **Step 4: 实现 CommandProtocol.kt**

```kotlin
package com.zenithjoy.agent.command

/** 指令动作集（对齐设计文档 8 指令）。 */
enum class CmdAction { SCREENSHOT, TAP, SWIPE, TYPE, KEY, LAUNCH, DEVICE_INFO, TREE_DUMP }

data class CmdRequest(val msgId: String, val action: CmdAction, val args: Map<String, Any?>)

/** 单条指令执行结果（执行层内部表示，经 buildResult 转回执 map）。 */
data class CmdOutcome(val ok: Boolean, val errorCode: String? = null, val data: Map<String, Any?> = emptyMap())

sealed class ParseOutcome {
    data class Ok(val request: CmdRequest) : ParseOutcome()
    data class Err(val code: String, val detail: String) : ParseOutcome()
}

object CommandProtocol {
    const val ERR_BAD_REQUEST = "BAD_REQUEST"
    const val ERR_UNKNOWN_ACTION = "UNKNOWN_ACTION"
    const val ERR_COORD_OUT_OF_BOUNDS = "COORD_OUT_OF_BOUNDS"
    const val ERR_QUEUE_FULL = "QUEUE_FULL"
    const val ERR_REMOTE_CONTROL_DISABLED = "REMOTE_CONTROL_DISABLED"
    const val ERR_DEVICE_BUSY_NATIVE = "DEVICE_BUSY_NATIVE"
    const val ERR_GESTURE_CANCELLED = "GESTURE_CANCELLED"
    const val ERR_GESTURE_TIMEOUT = "GESTURE_TIMEOUT"
    const val ERR_SERVICE_NOT_READY = "SERVICE_NOT_READY"
    const val ERR_NOT_INITIALIZED = "NOT_INITIALIZED"
    const val ERR_NEED_USER_REAUTH = "NEED_USER_REAUTH"
    const val ERR_CAPTURE_FAILED = "CAPTURE_FAILED"
    const val ERR_NO_FOCUSED_EDITABLE = "NO_FOCUSED_EDITABLE"
    const val ERR_SET_TEXT_FAILED = "SET_TEXT_FAILED"
    const val ERR_REFUSED_PACKAGE = "REFUSED_PACKAGE"
    const val ERR_PACKAGE_NOT_FOUND = "PACKAGE_NOT_FOUND"
    const val ERR_LAUNCH_FAILED = "LAUNCH_FAILED"
    const val ERR_LAUNCH_NOT_FOREGROUND = "LAUNCH_NOT_FOREGROUND"
    const val ERR_EXEC_EXCEPTION = "EXEC_EXCEPTION"
    const val ERR_TREE_UNAVAILABLE = "TREE_UNAVAILABLE"

    private const val MIN_SWIPE_MS = 50L
    private const val MAX_SWIPE_MS = 10_000L
    private const val DEFAULT_SWIPE_MS = 300L

    fun parse(msgId: String?, payload: Map<*, *>, screenW: Int, screenH: Int): ParseOutcome {
        if (msgId.isNullOrEmpty()) return ParseOutcome.Err(ERR_BAD_REQUEST, "missing msgId")
        val action = when ((payload["action"] as? String)?.lowercase()) {
            "screenshot" -> CmdAction.SCREENSHOT
            "tap" -> CmdAction.TAP
            "swipe" -> CmdAction.SWIPE
            "type" -> CmdAction.TYPE
            "key" -> CmdAction.KEY
            "launch" -> CmdAction.LAUNCH
            "device_info" -> CmdAction.DEVICE_INFO
            "tree_dump" -> CmdAction.TREE_DUMP
            else -> return ParseOutcome.Err(ERR_UNKNOWN_ACTION, "action=${payload["action"]}")
        }
        val args = mutableMapOf<String, Any?>()
        when (action) {
            CmdAction.TAP -> {
                val x = num(payload["x"]) ?: return bad("missing x")
                val y = num(payload["y"]) ?: return bad("missing y")
                if (x < 0 || y < 0 || x >= screenW || y >= screenH) {
                    return ParseOutcome.Err(ERR_COORD_OUT_OF_BOUNDS, "($x,$y) vs ${screenW}x$screenH")
                }
                args["x"] = x; args["y"] = y
            }
            CmdAction.SWIPE -> {
                val pts = listOf("x1", "y1", "x2", "y2").map { num(payload[it]) ?: return bad("missing $it") }
                if (pts[0] < 0 || pts[2] < 0 || pts[0] >= screenW || pts[2] >= screenW ||
                    pts[1] < 0 || pts[3] < 0 || pts[1] >= screenH || pts[3] >= screenH
                ) return ParseOutcome.Err(ERR_COORD_OUT_OF_BOUNDS, "swipe pts vs ${screenW}x$screenH")
                args["x1"] = pts[0]; args["y1"] = pts[1]; args["x2"] = pts[2]; args["y2"] = pts[3]
                val dur = (payload["durationMs"] as? Number)?.toLong() ?: DEFAULT_SWIPE_MS
                args["durationMs"] = dur.coerceIn(MIN_SWIPE_MS, MAX_SWIPE_MS)
            }
            CmdAction.TYPE -> {
                val text = payload["text"] as? String ?: return bad("missing text")
                args["text"] = text
            }
            CmdAction.KEY -> {
                val name = (payload["name"] as? String)?.lowercase()
                if (name != "back" && name != "home") return bad("key name must be back|home")
                args["name"] = name
            }
            CmdAction.LAUNCH -> {
                val pkg = payload["pkg"] as? String
                if (pkg.isNullOrEmpty()) return bad("missing pkg")
                args["pkg"] = pkg
            }
            else -> Unit // screenshot / device_info / tree_dump 无参数
        }
        return ParseOutcome.Ok(CmdRequest(msgId, action, args))
    }

    fun buildResult(inReplyTo: String, outcome: CmdOutcome, foregroundPkg: String?): Map<String, Any?> =
        mutableMapOf<String, Any?>(
            "inReplyTo" to inReplyTo,
            "ok" to outcome.ok,
            "foregroundPkg" to foregroundPkg,
        ).apply {
            if (outcome.errorCode != null) put("errorCode", outcome.errorCode)
            if (outcome.data.isNotEmpty()) put("data", outcome.data)
        }

    private fun num(v: Any?): Int? = (v as? Number)?.toInt()
    private fun bad(detail: String) = ParseOutcome.Err(ERR_BAD_REQUEST, detail)
}
```

- [ ] **Step 5: Run test 转绿并 commit**

Run: 同 Step 2，Expected: PASS
```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandProtocol.kt
git commit -m "feat(agent-cmd): CommandProtocol 解析/校验/回执（绿）"
```

---

### Task 2: AutomationLease（owner+租约原子锁）

**Files:**
- Create: `.../command/AutomationLease.kt`
- Test: `.../command/AutomationLeaseTest.kt`

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent.command

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationLeaseTest {
    @After fun tearDown() = AutomationLease.resetForTest()

    @Test fun `acquire 后 currentOwner 可见`() {
        assertTrue(AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE))
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `他人未过期时 acquire 失败`() {
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        assertFalse(AutomationLease.tryAcquire("someone_else"))
    }

    @Test fun `同 owner 重复 acquire 等于续租`() {
        var now = 0L
        AutomationLease.clock = { now }
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        now = AutomationLease.LEASE_MS - 1_000
        assertTrue(AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)) // 续租
        now = AutomationLease.LEASE_MS + 1_000 // 距首次已超期，但续租过所以仍有效
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `过期后自动可被抢占且 currentOwner 为 null`() {
        var now = 0L
        AutomationLease.clock = { now }
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        now = AutomationLease.LEASE_MS + 1
        assertNull(AutomationLease.currentOwner())
        assertTrue(AutomationLease.tryAcquire("someone_else"))
    }

    @Test fun `release 只清自己的锁`() {
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        AutomationLease.release("someone_else") // 不是 owner，无效
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
        AutomationLease.release(AutomationLease.OWNER_REMOTE)
        assertNull(AutomationLease.currentOwner())
    }

    @Test fun `isHeldByOther 判定`() {
        assertFalse(AutomationLease.isHeldByOther(AutomationLease.OWNER_NATIVE))
        AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)
        assertTrue(AutomationLease.isHeldByOther(AutomationLease.OWNER_NATIVE))
        assertFalse(AutomationLease.isHeldByOther(AutomationLease.OWNER_REMOTE))
    }
}
```

- [ ] **Step 2: Run 确认编译失败 → commit failing test**（命令模式同 Task 1）

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/AutomationLeaseTest.kt
git commit -m "test(agent-cmd): AutomationLease 租约锁 failing tests（红）"
```

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

import java.util.concurrent.atomic.AtomicReference

/**
 * 一机一自动化互斥（owner + 租约）。远程指令会话经 executor 每条指令续租；
 * 原生服务任务入口用 [isHeldByOther] 拒单。租约 120s 无续租自动过期——防
 * AI 循环在中台侧中止后设备端锁死原生流程（ScanMutex 永久 busy 事故前科，
 * 见 account/DeviceAccountScanService.kt:1265 注释）。
 * 注意：本锁不取代 ScanMutex（原生服务间互斥仍走 ScanMutex），只表达
 * 「远程指令会话正在驱动本机」这一事实。
 */
object AutomationLease {
    const val OWNER_REMOTE = "remote_cmd"
    const val OWNER_NATIVE = "native_task"
    const val LEASE_MS = 120_000L

    data class Holder(val owner: String, val expiresAt: Long)

    private val ref = AtomicReference<Holder?>(null)

    @Volatile
    var clock: () -> Long = { System.currentTimeMillis() }

    fun tryAcquire(owner: String): Boolean {
        while (true) {
            val now = clock()
            val cur = ref.get()
            if (cur != null && cur.owner != owner && cur.expiresAt > now) return false
            if (ref.compareAndSet(cur, Holder(owner, now + LEASE_MS))) return true
        }
    }

    fun release(owner: String) {
        val cur = ref.get() ?: return
        if (cur.owner == owner) ref.compareAndSet(cur, null)
    }

    fun currentOwner(): String? {
        val cur = ref.get() ?: return null
        return if (cur.expiresAt > clock()) cur.owner else null
    }

    fun isHeldByOther(me: String): Boolean = currentOwner()?.let { it != me } ?: false

    fun resetForTest() {
        ref.set(null)
        clock = { System.currentTimeMillis() }
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/AutomationLease.kt
git commit -m "feat(agent-cmd): AutomationLease owner+租约原子锁（绿）"
```

---

### Task 3: CommandQueue（有界+去重+串行）

**Files:**
- Create: `.../command/CommandQueue.kt`
- Test: `.../command/CommandQueueTest.kt`

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class CommandQueueTest {
    private fun req(id: String) = CmdRequest(id, CmdAction.DEVICE_INFO, emptyMap())

    @Test fun `执行结果按序回传且带 inReplyTo`() = runTest {
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, execute = { r -> mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a")); q.submit(req("b"))
        advanceUntilIdle()
        assertEquals(listOf("a", "b"), sent.map { it["inReplyTo"] })
        q.close()
    }

    @Test fun `同 msgId 重复提交返回缓存结果不重执行`() = runTest {
        var execCount = 0
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, execute = { r -> execCount++; mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a"))
        advanceUntilIdle()
        q.submit(req("a")) // 重投递
        advanceUntilIdle()
        assertEquals(1, execCount)
        assertEquals(2, sent.size) // 两次都回了结果
        q.close()
    }

    @Test fun `队列满回 QUEUE_FULL`() = runTest {
        // StandardTestDispatcher 下消费协程在 advanceUntilIdle 前不运行：
        // a、b 占满 capacity=2 缓冲，c 溢出 → 确定性 QUEUE_FULL
        val sent = mutableListOf<Map<String, Any?>>()
        val q = CommandQueue(this, capacity = 2, execute = { r -> mapOf("inReplyTo" to r.msgId, "ok" to true) }, sendResult = { sent.add(it); true })
        q.submit(req("a")); q.submit(req("b")); q.submit(req("c"))
        val full = sent.first { it["inReplyTo"] == "c" }
        assertEquals(CommandProtocol.ERR_QUEUE_FULL, full["errorCode"])
        advanceUntilIdle()
        q.close()
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandQueueTest.kt
git commit -m "test(agent-cmd): CommandQueue 串行/去重/满拒 failing tests（红）"
```

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * 有界指令队列：入队立即返回（okhttp reader 线程绝不阻塞），单消费协程串行执行。
 * correlation-id LRU 去重：同 msgId 重复到达返回缓存首次结果，不重放动作
 * （heartbeat 重投递前科见 AgentService dmSeenTaskIds 注释）；重连后中台按
 * msgId 重发也走这条路，天然实现「断线结果重取」。
 */
class CommandQueue(
    scope: CoroutineScope,
    private val execute: suspend (CmdRequest) -> Map<String, Any?>,
    private val sendResult: (Map<String, Any?>) -> Boolean,
    capacity: Int = 8,
    private val dedupCapacity: Int = 32,
) {
    private val channel = Channel<CmdRequest>(capacity)
    private val done = object : LinkedHashMap<String, Map<String, Any?>>(dedupCapacity, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Map<String, Any?>>) = size > dedupCapacity
    }
    private val lock = Any()
    private val consumer: Job = scope.launch {
        for (req in channel) {
            val result = execute(req)
            synchronized(lock) { done[req.msgId] = result }
            if (!sendResult(result)) {
                logW("result dropped (connection lost) msgId=${req.msgId}; cached for re-delivery")
            }
        }
    }

    fun submit(request: CmdRequest) {
        val cached = synchronized(lock) { done[request.msgId] }
        if (cached != null) { sendResult(cached); return }
        if (!channel.trySend(request).isSuccess) {
            sendResult(
                CommandProtocol.buildResult(
                    request.msgId,
                    CmdOutcome(false, CommandProtocol.ERR_QUEUE_FULL),
                    null,
                ),
            )
        }
    }

    fun close() {
        channel.close()
        consumer.cancel()
    }

    private fun logW(message: String) {
        try { android.util.Log.w("CommandQueue", message) } catch (_: RuntimeException) { /* JVM 单测 */ }
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandQueue.kt
git commit -m "feat(agent-cmd): CommandQueue 有界队列+去重+串行消费（绿）"
```

---

### Task 4: GestureRunner（三态）

**Files:**
- Create: `.../command/GestureRunner.kt`
- Test: `.../command/GestureRunnerTest.kt`

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureRunnerTest {
    private val pts = listOf(100f to 200f)

    @Test fun `onCompleted 回调为成功`() = runTest {
        val r = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true })
        assertTrue(r.run(pts, 50).ok)
    }

    @Test fun `onCancelled 回调为 GESTURE_CANCELLED`() = runTest {
        val r = GestureRunner(dispatch = { _, _, onResult -> onResult(false); true })
        assertEquals(CommandProtocol.ERR_GESTURE_CANCELLED, r.run(pts, 50).errorCode)
    }

    @Test fun `dispatch 返回 false 为 SERVICE_NOT_READY`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> false })
        assertEquals(CommandProtocol.ERR_SERVICE_NOT_READY, r.run(pts, 50).errorCode)
    }

    @Test fun `回调不来超时为 GESTURE_TIMEOUT`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> true }, timeoutMs = 10)
        assertEquals(CommandProtocol.ERR_GESTURE_TIMEOUT, r.run(pts, 50).errorCode)
    }

    @Test fun `dispatch 抛异常为 EXEC_EXCEPTION`() = runTest {
        val r = GestureRunner(dispatch = { _, _, _ -> throw IllegalStateException("boom") })
        assertEquals(CommandProtocol.ERR_EXEC_EXCEPTION, r.run(pts, 50).errorCode)
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/GestureRunnerTest.kt
git commit -m "test(agent-cmd): GestureRunner 三态判定 failing tests（红）"
```

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * tap/swipe 执行封装。判定点（decision「tap/swipe 手势成功判定」）：必须用
 * GestureResultCallback 三态，不能沿用全仓 9 处「dispatch 提交即成功」的旧姿势
 * ——那会把 GESTURE_CANCELLED（如恰逢用户手指触屏）谎报成功，AI 循环基于假成功推理。
 *
 * dispatch 抽象：生产实现构造 GestureDescription 并注册回调（onCompleted→onResult(true)、
 * onCancelled→onResult(false)），返回 dispatchGesture 的 Boolean；服务未绑定返回 false。
 */
class GestureRunner(
    private val dispatch: (points: List<Pair<Float, Float>>, durationMs: Long, onResult: (Boolean) -> Unit) -> Boolean,
    private val timeoutMs: Long = 5_000L,
) {
    suspend fun run(points: List<Pair<Float, Float>>, durationMs: Long): CmdOutcome {
        val done = CompletableDeferred<Boolean>()
        val submitted = try {
            dispatch(points, durationMs) { done.complete(it) }
        } catch (e: Exception) {
            return CmdOutcome(false, CommandProtocol.ERR_EXEC_EXCEPTION, mapOf("detail" to (e.message ?: e.javaClass.simpleName)))
        }
        if (!submitted) return CmdOutcome(false, CommandProtocol.ERR_SERVICE_NOT_READY)
        return when (withTimeoutOrNull(timeoutMs) { done.await() }) {
            true -> CmdOutcome(true)
            false -> CmdOutcome(false, CommandProtocol.ERR_GESTURE_CANCELLED)
            null -> CmdOutcome(false, CommandProtocol.ERR_GESTURE_TIMEOUT)
        }
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/GestureRunner.kt
git commit -m "feat(agent-cmd): GestureRunner 三态手势执行（绿）"
```

---

### Task 5: ScreenshotRunner（错误分类 + 双分辨率）

**Files:**
- Create: `.../command/ScreenshotRunner.kt`
- Test: `.../command/ScreenshotRunnerTest.kt`

**前置**：读 `ScreenCaptureReal.kt:185-192` 的 `scaleDownIfNeeded` 缩放取整方式，`computeCaptureDims` 必须与其完全一致（下面代码假定「长边>720 时按比例缩、四舍五入」，若实际是 toInt 截断则改为一致并同步测试期望值）。

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotRunnerTest {
    @Test fun `未初始化回 NOT_INITIALIZED`() = runTest {
        val r = ScreenshotRunner({ false }, { true }, { "x" }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_NOT_INITIALIZED, r.run().errorCode)
    }

    @Test fun `无授权回 NEED_USER_REAUTH（永久性，上游停止重试）`() = runTest {
        val r = ScreenshotRunner({ true }, { false }, { "x" }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_NEED_USER_REAUTH, r.run().errorCode)
    }

    @Test fun `撞锁重试3次仍 null 回 CAPTURE_FAILED`() = runTest {
        var calls = 0
        val r = ScreenshotRunner({ true }, { true }, { calls++; null }, { 1080 to 2400 }, sleep = {})
        assertEquals(CommandProtocol.ERR_CAPTURE_FAILED, r.run().errorCode)
        assertEquals(3, calls)
    }

    @Test fun `第二次重试成功且回执带双分辨率`() = runTest {
        var calls = 0
        val r = ScreenshotRunner({ true }, { true }, { calls++; if (calls >= 2) "b64data" else null }, { 1080 to 2400 }, sleep = {})
        val o = r.run()
        assertTrue(o.ok)
        assertEquals("b64data", o.data["imageBase64"])
        assertEquals(1080, o.data["screenWidth"]); assertEquals(2400, o.data["screenHeight"])
        assertEquals(324, o.data["captureWidth"]); assertEquals(720, o.data["captureHeight"])
    }

    @Test fun `computeCaptureDims 长边不超720不缩`() {
        assertEquals(600 to 700, ScreenshotRunner.computeCaptureDims(600, 700))
        assertEquals(324 to 720, ScreenshotRunner.computeCaptureDims(1080, 2400))
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/ScreenshotRunnerTest.kt
git commit -m "test(agent-cmd): ScreenshotRunner 错误分类/双分辨率 failing tests（红）"
```

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.delay

/**
 * screenshot 指令。错误码永久/瞬时分类（判定点「screenshot 失败分类」）：
 * NEED_USER_REAUTH / NOT_INITIALIZED 永久（上游停止重试并告警）；CAPTURE_FAILED 瞬时
 * （含撞 8fps 推流单飞锁与 blank 帧，二者现有 ScreenCaptureService API 下不可分，
 * 有意合并，detail 注明）。回执必带双分辨率（判定点「截图↔点击坐标系对齐」）：
 * 截图被 ScreenCaptureReal 压到长边 720px，点击用物理坐标，上游必须换算。
 */
class ScreenshotRunner(
    private val initialized: () -> Boolean,
    private val hasAuthorization: () -> Boolean,
    private val capture: () -> String?,
    private val screenSize: () -> Pair<Int, Int>,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    suspend fun run(): CmdOutcome {
        if (!initialized()) return CmdOutcome(false, CommandProtocol.ERR_NOT_INITIALIZED)
        if (!hasAuthorization()) return CmdOutcome(false, CommandProtocol.ERR_NEED_USER_REAUTH)
        var b64: String? = null
        for (attempt in 0 until 3) {
            b64 = capture()
            if (b64 != null) break
            if (attempt < 2) sleep(100)
        }
        if (b64 == null) {
            return CmdOutcome(false, CommandProtocol.ERR_CAPTURE_FAILED, mapOf("detail" to "busy_or_blank_after_3_attempts"))
        }
        val (sw, sh) = screenSize()
        val (cw, ch) = computeCaptureDims(sw, sh)
        return CmdOutcome(
            true,
            data = mapOf(
                "imageBase64" to b64,
                "captureWidth" to cw, "captureHeight" to ch,
                "screenWidth" to sw, "screenHeight" to sh,
            ),
        )
    }

    companion object {
        /** 与 ScreenCaptureReal.MAX_DIMENSION_PX / scaleDownIfNeeded 保持一致（实现前核对取整方式）。 */
        const val MAX_DIMENSION_PX = 720

        fun computeCaptureDims(w: Int, h: Int, maxDim: Int = MAX_DIMENSION_PX): Pair<Int, Int> {
            val longEdge = maxOf(w, h)
            if (longEdge <= maxDim || longEdge <= 0) return w to h
            val scale = maxDim.toFloat() / longEdge
            return Math.round(w * scale) to Math.round(h * scale)
        }
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/ScreenshotRunner.kt
git commit -m "feat(agent-cmd): ScreenshotRunner 错误分类+双分辨率回执（绿）"
```

---

### Task 6: TypeRunner + LaunchRunner

**Files:**
- Create: `.../command/TypeRunner.kt`、`.../command/LaunchRunner.kt`
- Test: `.../command/TypeRunnerTest.kt`、`.../command/LaunchRunnerTest.kt`

- [ ] **Step 1: failing tests（两个文件）**

```kotlin
package com.zenithjoy.agent.command

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TypeRunnerTest {
    private val WL = setOf("com.ss.android.ugc.aweme")

    @Test fun `前台不在白名单拒绝`() {
        val r = TypeRunner({ "com.android.settings" }, WL, { true })
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("hi").errorCode)
    }

    @Test fun `前台包名读不到拒绝`() {
        val r = TypeRunner({ null }, WL, { true })
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("hi").errorCode)
    }

    @Test fun `无焦点可编辑节点回 NO_FOCUSED_EDITABLE`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { null })
        assertEquals(CommandProtocol.ERR_NO_FOCUSED_EDITABLE, r.run("hi").errorCode)
    }

    @Test fun `SET_TEXT 返回 false 回 SET_TEXT_FAILED`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { false })
        assertEquals(CommandProtocol.ERR_SET_TEXT_FAILED, r.run("hi").errorCode)
    }

    @Test fun `成功路径`() {
        val r = TypeRunner({ "com.ss.android.ugc.aweme" }, WL, { true })
        assertTrue(r.run("hi").ok)
    }
}
```

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchRunnerTest {
    private val PKG = "com.ss.android.ugc.aweme"
    private val WL = setOf(PKG)

    @Test fun `白名单外拒绝`() = runTest {
        val r = LaunchRunner(WL, { true }, { true }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_REFUSED_PACKAGE, r.run("com.other").errorCode)
    }

    @Test fun `包不存在回 PACKAGE_NOT_FOUND`() = runTest {
        val r = LaunchRunner(WL, { false }, { true }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_PACKAGE_NOT_FOUND, r.run(PKG).errorCode)
    }

    @Test fun `startLaunch 失败回 LAUNCH_FAILED`() = runTest {
        val r = LaunchRunner(WL, { true }, { false }, { PKG }, sleep = {})
        assertEquals(CommandProtocol.ERR_LAUNCH_FAILED, r.run(PKG).errorCode)
    }

    @Test fun `前台轮询到目标包才算成功（判定点：ColorOS静默拦截）`() = runTest {
        var polls = 0
        val r = LaunchRunner(WL, { true }, { true }, { polls++; if (polls >= 3) PKG else "com.launcher" }, sleep = {})
        assertTrue(r.run(PKG).ok)
    }

    @Test fun `超时未到前台回 LAUNCH_NOT_FOREGROUND 且带实际前台`() = runTest {
        val r = LaunchRunner(WL, { true }, { true }, { "com.launcher" }, sleep = {}, timeoutMs = 1_000, pollIntervalMs = 500)
        val o = r.run(PKG)
        assertEquals(CommandProtocol.ERR_LAUNCH_NOT_FOREGROUND, o.errorCode)
        assertEquals("com.launcher", o.data["foreground"])
    }
}
```

- [ ] **Step 2: Run 红 → commit failing tests**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/TypeRunnerTest.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/LaunchRunnerTest.kt
git commit -m "test(agent-cmd): TypeRunner/LaunchRunner failing tests（红）"
```

- [ ] **Step 3: 实现（两个文件）**

```kotlin
package com.zenithjoy.agent.command

/**
 * type 指令：向当前焦点可编辑节点 SET_TEXT（整段替换语义）。
 * 白名单硬红线：前台包不在白名单（首版只放抖音系）一律拒——type+launch 组合
 * 否则可对任意 app（银行/短信）注入文本。
 * setTextOnFocusedEditable 契约：null=无焦点可编辑节点；true/false=SET_TEXT 执行结果。
 */
class TypeRunner(
    private val foregroundPkg: () -> String?,
    private val whitelist: Set<String>,
    private val setTextOnFocusedEditable: (String) -> Boolean?,
) {
    fun run(text: String): CmdOutcome {
        val pkg = foregroundPkg()
        if (pkg == null || pkg !in whitelist) {
            return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to (pkg ?: "unknown")))
        }
        return when (setTextOnFocusedEditable(text)) {
            null -> CmdOutcome(false, CommandProtocol.ERR_NO_FOCUSED_EDITABLE)
            true -> CmdOutcome(true)
            false -> CmdOutcome(false, CommandProtocol.ERR_SET_TEXT_FAILED)
        }
    }
}
```

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.delay

/**
 * launch 指令。判定点（decision「launch 应用拉起成功判定」）：成功=前台包名轮询
 * 真到目标包，绝不以「startActivity 没抛异常」为准——ColorOS 静默拦截不抛异常
 * （DouyinCollectService.kt:224 真机实锤）、荣耀 iAware 拒后台拉起。
 * startLaunch 生产实现走 DouyinLaunchTrampoline（透明 trampoline，AgentService
 * videoOpener 同款姿势），异常时回退直启，任何路径抛异常返回 false。
 */
class LaunchRunner(
    private val whitelist: Set<String>,
    private val packageExists: (String) -> Boolean,
    private val startLaunch: (String) -> Boolean,
    private val foregroundPkg: () -> String?,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val pollIntervalMs: Long = 500L,
    private val timeoutMs: Long = 10_000L,
) {
    suspend fun run(pkg: String): CmdOutcome {
        if (pkg !in whitelist) return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to pkg))
        if (!packageExists(pkg)) return CmdOutcome(false, CommandProtocol.ERR_PACKAGE_NOT_FOUND)
        if (!startLaunch(pkg)) return CmdOutcome(false, CommandProtocol.ERR_LAUNCH_FAILED)
        var waited = 0L
        while (waited < timeoutMs) {
            if (foregroundPkg() == pkg) return CmdOutcome(true)
            sleep(pollIntervalMs)
            waited += pollIntervalMs
        }
        return CmdOutcome(false, CommandProtocol.ERR_LAUNCH_NOT_FOREGROUND, mapOf("foreground" to (foregroundPkg() ?: "unknown")))
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/TypeRunner.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/LaunchRunner.kt
git commit -m "feat(agent-cmd): TypeRunner 白名单+焦点语义 / LaunchRunner 前台验证（绿）"
```

---

### Task 7: CommandExecutor（路由/开关/互斥门/异常兜底）

**Files:**
- Create: `.../command/CommandExecutor.kt`
- Test: `.../command/CommandExecutorTest.kt`

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent.command

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandExecutorTest {
    @After fun tearDown() = AutomationLease.resetForTest()

    private fun executor(
        remoteEnabled: Boolean = true,
        nativeBusy: Boolean = false,
        treeDump: () -> Map<String, Any?>? = { mapOf("tree" to "d0 root", "truncated" to false) },
    ) = CommandExecutor(
        remoteControlEnabled = { remoteEnabled },
        nativeBusy = { nativeBusy },
        foregroundPkg = { "com.ss.android.ugc.aweme" },
        gesture = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true }),
        screenshot = ScreenshotRunner({ true }, { true }, { "b64" }, { 1080 to 2400 }, sleep = {}),
        type = TypeRunner({ "com.ss.android.ugc.aweme" }, setOf("com.ss.android.ugc.aweme"), { true }),
        launch = LaunchRunner(setOf("com.ss.android.ugc.aweme"), { true }, { true }, { "com.ss.android.ugc.aweme" }, sleep = {}),
        globalAction = { true },
        deviceInfo = { mapOf("model" to "TEST") },
        treeDump = treeDump,
    )

    private fun req(action: CmdAction, args: Map<String, Any?> = emptyMap()) = CmdRequest("m1", action, args)

    @Test fun `远程协助关闭时敏感指令拒绝但 tap 放行`() = runTest {
        val e = executor(remoteEnabled = false)
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.SCREENSHOT))["errorCode"])
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.TYPE, mapOf("text" to "x")))["errorCode"])
        assertEquals(CommandProtocol.ERR_REMOTE_CONTROL_DISABLED, e.execute(req(CmdAction.TREE_DUMP))["errorCode"])
        assertEquals(true, e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))["ok"])
    }

    @Test fun `原生任务在跑时变更类指令回 DEVICE_BUSY_NATIVE 只读类放行`() = runTest {
        val e = executor(nativeBusy = true)
        assertEquals(CommandProtocol.ERR_DEVICE_BUSY_NATIVE, e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))["errorCode"])
        assertEquals(true, e.execute(req(CmdAction.SCREENSHOT))["ok"])
        assertEquals(true, e.execute(req(CmdAction.DEVICE_INFO))["ok"])
    }

    @Test fun `变更类指令执行后远程租约被持有`() = runTest {
        val e = executor()
        e.execute(req(CmdAction.TAP, mapOf("x" to 1, "y" to 1)))
        assertEquals(AutomationLease.OWNER_REMOTE, AutomationLease.currentOwner())
    }

    @Test fun `回执总带 inReplyTo 与前台包名`() = runTest {
        val m = executor().execute(req(CmdAction.DEVICE_INFO))
        assertEquals("m1", m["inReplyTo"])
        assertEquals("com.ss.android.ugc.aweme", m["foregroundPkg"])
    }

    @Test fun `treeDump 为 null 回 TREE_UNAVAILABLE`() = runTest {
        val e = executor(treeDump = { null })
        assertEquals(CommandProtocol.ERR_TREE_UNAVAILABLE, e.execute(req(CmdAction.TREE_DUMP))["errorCode"])
    }

    @Test fun `执行器内部异常转 EXEC_EXCEPTION 不上抛`() = runTest {
        val e = executor(treeDump = { throw IllegalStateException("boom") })
        val m = e.execute(req(CmdAction.TREE_DUMP))
        assertEquals(CommandProtocol.ERR_EXEC_EXCEPTION, m["errorCode"])
        assertTrue((m["data"] as Map<*, *>)["detail"].toString().contains("boom"))
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt
git commit -m "test(agent-cmd): CommandExecutor 路由/开关/互斥门 failing tests（红）"
```

- [ ] **Step 3: 实现**

```kotlin
package com.zenithjoy.agent.command

/**
 * 指令路由与执行门禁。层次：远程协助开关（敏感指令 screenshot/type/tree_dump）
 * → 原生互斥门（变更类指令 tap/swipe/type/key/launch 在 ScanMutex.busy 时拒）
 * → 远程租约续租 → 分发到 Runner。一切异常转 EXEC_EXCEPTION 回执，
 * 绝不崩无障碍服务（0824 Path 负界崩溃前科）。
 */
class CommandExecutor(
    private val remoteControlEnabled: () -> Boolean,
    private val nativeBusy: () -> Boolean,
    private val foregroundPkg: () -> String?,
    private val gesture: GestureRunner,
    private val screenshot: ScreenshotRunner,
    private val type: TypeRunner,
    private val launch: LaunchRunner,
    private val globalAction: (String) -> Boolean,
    private val deviceInfo: () -> Map<String, Any?>,
    private val treeDump: () -> Map<String, Any?>?,
) {
    private val mutating = setOf(CmdAction.TAP, CmdAction.SWIPE, CmdAction.TYPE, CmdAction.KEY, CmdAction.LAUNCH)
    private val sensitive = setOf(CmdAction.SCREENSHOT, CmdAction.TYPE, CmdAction.TREE_DUMP)

    suspend fun execute(req: CmdRequest): Map<String, Any?> {
        val outcome = try {
            executeInner(req)
        } catch (e: Exception) {
            CmdOutcome(false, CommandProtocol.ERR_EXEC_EXCEPTION, mapOf("detail" to (e.message ?: e.javaClass.simpleName)))
        }
        val fg = try { foregroundPkg() } catch (_: Exception) { null }
        return CommandProtocol.buildResult(req.msgId, outcome, fg)
    }

    private suspend fun executeInner(req: CmdRequest): CmdOutcome {
        if (req.action in sensitive && !remoteControlEnabled()) {
            return CmdOutcome(false, CommandProtocol.ERR_REMOTE_CONTROL_DISABLED)
        }
        if (req.action in mutating) {
            if (nativeBusy()) return CmdOutcome(false, CommandProtocol.ERR_DEVICE_BUSY_NATIVE)
            if (!AutomationLease.tryAcquire(AutomationLease.OWNER_REMOTE)) {
                return CmdOutcome(false, CommandProtocol.ERR_DEVICE_BUSY_NATIVE)
            }
        }
        return when (req.action) {
            CmdAction.SCREENSHOT -> screenshot.run()
            CmdAction.TAP -> {
                val x = (req.args["x"] as Number).toFloat()
                val y = (req.args["y"] as Number).toFloat()
                gesture.run(listOf(x to y), durationMs = 50L)
            }
            CmdAction.SWIPE -> {
                val p1 = (req.args["x1"] as Number).toFloat() to (req.args["y1"] as Number).toFloat()
                val p2 = (req.args["x2"] as Number).toFloat() to (req.args["y2"] as Number).toFloat()
                gesture.run(listOf(p1, p2), durationMs = (req.args["durationMs"] as Number).toLong())
            }
            CmdAction.TYPE -> type.run(req.args["text"] as String)
            CmdAction.KEY -> if (globalAction(req.args["name"] as String)) CmdOutcome(true)
                else CmdOutcome(false, CommandProtocol.ERR_SERVICE_NOT_READY)
            CmdAction.LAUNCH -> launch.run(req.args["pkg"] as String)
            CmdAction.DEVICE_INFO -> CmdOutcome(true, data = deviceInfo())
            CmdAction.TREE_DUMP -> treeDump()?.let { CmdOutcome(true, data = it) }
                ?: CmdOutcome(false, CommandProtocol.ERR_TREE_UNAVAILABLE)
        }
    }
}
```

- [ ] **Step 4: Run 转绿 → commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/CommandExecutor.kt
git commit -m "feat(agent-cmd): CommandExecutor 路由+开关+互斥门+异常兜底（绿）"
```

---

### Task 8: WsClient 改造（信封解析提取 / sendResult / busy 探针 / token 日志脱敏）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/WsClient.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/WsEnvelopeTest.kt`

- [ ] **Step 1: failing test**

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WsEnvelopeTest {
    @Test fun `解析信封透传 msgId`() {
        val e = WsEnvelope.parse("""{"v":1,"type":"cmd","msgId":"abc","payload":{"action":"tap"}}""")!!
        assertEquals("cmd", e.type)
        assertEquals("abc", e.msgId)
        assertEquals("tap", e.payload["action"])
    }

    @Test fun `缺 msgId 时为 null 不炸`() {
        val e = WsEnvelope.parse("""{"type":"heartbeat_ack","payload":{}}""")!!
        assertNull(e.msgId)
    }

    @Test fun `非法 JSON 返回 null`() {
        assertNull(WsEnvelope.parse("not json"))
    }

    @Test fun `缺 type 返回 null`() {
        assertNull(WsEnvelope.parse("""{"payload":{}}"""))
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/WsEnvelopeTest.kt
git commit -m "test(agent-cmd): WsEnvelope 信封解析 failing tests（红）"
```

- [ ] **Step 3: 改造 WsClient.kt**

改动点（在现有文件上编辑，行号基于当前版本）：

1. 文件顶部新增信封类型（同文件内，WsClient 类之前）：

```kotlin
/** 下行消息信封（对齐 agent-protocol.ts {v,type,msgId,ts,payload}），解析抽出便于 JVM 单测。 */
internal data class WsEnvelope(val type: String, val payload: Map<*, *>, val msgId: String?) {
    companion object {
        private val gson = com.google.gson.Gson()
        fun parse(text: String): WsEnvelope? = try {
            @Suppress("UNCHECKED_CAST")
            val msg = gson.fromJson(text, Map::class.java) as Map<String, Any>
            val type = msg["type"] as? String ?: return null
            val payload = msg["payload"] as? Map<*, *> ?: emptyMap<String, Any>()
            WsEnvelope(type, payload, msg["msgId"] as? String)
        } catch (e: Exception) { null }
    }
}
```

2. 构造参数改为（line 30-34）：

```kotlin
class WsClient(
    private val config: AgentConfig,
    private val scope: CoroutineScope,
    private val onMessage: ((type: String, payload: Map<*, *>, msgId: String?) -> Unit)? = null,
    private val busyProbe: () -> Boolean = { false },
    private val onDisconnect: (() -> Unit)? = null,
) {
```

3. line 58 token 日志脱敏：

```kotlin
android.util.Log.i(TAG, "connecting (ws0) to ${config.apiUrl}")
```

4. heartbeat busy（line 119）：`"busy" to busyProbe(),`

5. onClosed / onFailure 各追加 `onDisconnect?.invoke()`（在 latch.countDown() 之前）。

6. handleMessage 重写：

```kotlin
    private fun handleMessage(text: String) {
        val envelope = WsEnvelope.parse(text)
        if (envelope == null) {
            android.util.Log.w(TAG, "invalid message")
            return
        }
        android.util.Log.d(TAG, "received: ${envelope.type}")
        onMessage?.invoke(envelope.type, envelope.payload, envelope.msgId)
    }
```

7. 新增公开发送（makeMsg 复用）：

```kotlin
    /** 指令回执上行（cmd_result）。断线（wsRef null）返回 false，由 CommandQueue 记日志并靠去重缓存等重投。 */
    fun sendResult(payload: Map<String, Any?>): Boolean {
        val ws = wsRef.get() ?: return false
        return ws.send(gson.toJson(makeMsg("cmd_result", payload)))
    }
```

8. **同步改唯一调用点** `AgentService.kt:386-392` 的 lambda 为三参：`onMessage = { type, payload, msgId -> ... }`（本 Task 只让编译通过，`cmd` 路由留给 Task 9）。

- [ ] **Step 4: Run（WsEnvelopeTest + 全量编译）转绿 → commit**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest 2>&1 | tail -5`
Expected: BUILD SUCCESSFUL（全量测试不回归）

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/WsClient.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
git commit -m "feat(agent-cmd): WsClient msgId透传+sendResult+busy探针+token日志脱敏（绿）"
```

---

### Task 9: AgentService 接线（cmd 路由 + Runner 生产装配）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentConfig.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（companion 加访问器）
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandWiringSourceTest.kt`

- [ ] **Step 1: failing test（源码文本断言，先例 DeviceAccountScanServiceSharedCaptureTest.kt）**

```kotlin
package com.zenithjoy.agent.command

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 接线断言（源码文本级，先例 DeviceAccountScanServiceSharedCaptureTest）。 */
class CommandWiringSourceTest {
    private fun src(path: String) = File("src/main/kotlin/com/zenithjoy/agent/$path").readText()

    @Test fun `AgentService 注册了 cmd 路由`() {
        val s = src("AgentService.kt")
        assertTrue("AgentService 必须路由 cmd 消息到 CommandQueue", s.contains("\"cmd\"") && s.contains("routeCommand"))
    }

    @Test fun `heartbeat busy 不再写死 false`() {
        val s = src("WsClient.kt")
        assertFalse("busy 必须走 busyProbe", s.contains("\"busy\" to false"))
        assertTrue(s.contains("busyProbe"))
    }

    @Test fun `WsClient 不再打印含 token 的完整 wsUrl`() {
        val s = src("WsClient.kt")
        assertFalse("token 泄漏日志必须移除（logcat 可读=整机可被冒充遥控）", s.contains("connecting to \$wsUrl"))
    }

    @Test fun `busyProbe 接了租约与 ScanMutex`() {
        val s = src("AgentService.kt")
        assertTrue(s.contains("AutomationLease.currentOwner()") && s.contains("ScanMutex.busy"))
    }

    @Test fun `远程协助开关存在且默认开`() {
        val s = src("AgentConfig.kt")
        assertTrue(s.contains("remoteControlEnabled"))
        assertTrue("Alex 2026-09-04 拍板默认开", s.contains("getBoolean(KEY_REMOTE_CONTROL_ENABLED, true)"))
    }
}
```

- [ ] **Step 2: Run 红 → commit failing test**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandWiringSourceTest.kt
git commit -m "test(agent-cmd): AgentService/WsClient/AgentConfig 接线断言 failing tests（红）"
```

- [ ] **Step 3: 实现接线**

3a. `AgentConfig.kt` 加字段（wallPushEnabled 同款模式）：

```kotlin
    /**
     * 「远程协助」开关：是否接受中台下发的设备指令（screenshot/tap/type 等，见 command 包）。
     * 默认 **开**（Alex 2026-09-04 拍板，全部机型）；保留租户/用户级关闭能力，
     * 关闭时敏感指令回 REMOTE_CONTROL_DISABLED。
     */
    var remoteControlEnabled: Boolean
        get() = prefs.getBoolean(KEY_REMOTE_CONTROL_ENABLED, true)
        set(v) = prefs.edit().putBoolean(KEY_REMOTE_CONTROL_ENABLED, v).apply()
```

companion 加 `private const val KEY_REMOTE_CONTROL_ENABLED = "remote_control_enabled"`（照既有 KEY_* 常量位置）。

3b. `DouyinCollectService.kt` companion（line 1955 附近）加：

```kotlin
        /** command 包唯一取用无障碍宿主的入口（GestureRunner/TypeRunner/tree_dump 用）。 */
        internal fun commandHost(): DouyinCollectService? = activeInstance
```

3c. `AgentService.kt`：新增字段 `private var commandQueue: com.zenithjoy.agent.command.CommandQueue? = null`；WsClient 构造改为：

```kotlin
        wsClient = WsClient(
            config = config,
            scope = scope,
            onMessage = { type, payload, msgId ->
                android.util.Log.d(TAG, "ws0 message: $type")
                when (type) {
                    "collect_task" -> routeCollectTask(payload)
                    "cmd" -> routeCommand(payload, msgId)
                }
            },
            busyProbe = {
                com.zenithjoy.agent.command.AutomationLease.currentOwner() != null ||
                    com.zenithjoy.agent.account.ScanMutex.busy
            },
        )
```

3d. `AgentService.kt` 新增装配与路由（放在 initAgent 内 sharedScreenCaptureService 赋值之后；imports 按需补 `android.accessibilityservice.AccessibilityService`、`android.accessibilityservice.GestureDescription`、`android.graphics.Path`、`android.os.Bundle`、`android.view.accessibility.AccessibilityNodeInfo`、`com.zenithjoy.agent.command.*`、`com.zenithjoy.agent.uia.UiTreeSnapshot`）：

```kotlin
        // ── OpenClaw 信号桥·件1：统一指令处理器装配（sprint 09041528）────────────
        val cmdWhitelist = setOf(
            "com.ss.android.ugc.aweme",          // 抖音
            "com.ss.android.ugc.aweme.lite",     // 抖音极速版
        )
        val cmdForegroundPkg: () -> String? = {
            DouyinCollectService.commandHost()?.rootInActiveWindow?.packageName?.toString()
        }
        val executor = CommandExecutor(
            remoteControlEnabled = { config.remoteControlEnabled },
            nativeBusy = { com.zenithjoy.agent.account.ScanMutex.busy },
            foregroundPkg = cmdForegroundPkg,
            gesture = GestureRunner(dispatch = { points, durationMs, onResult ->
                val svc = DouyinCollectService.commandHost()
                if (svc == null) {
                    false
                } else {
                    val path = Path().apply {
                        moveTo(points.first().first, points.first().second)
                        points.drop(1).forEach { lineTo(it.first, it.second) }
                    }
                    val g = GestureDescription.Builder()
                        .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
                        .build()
                    svc.dispatchGesture(g, object : AccessibilityService.GestureResultCallback() {
                        override fun onCompleted(gd: GestureDescription?) { onResult(true) }
                        override fun onCancelled(gd: GestureDescription?) { onResult(false) }
                    }, null)
                }
            }),
            screenshot = ScreenshotRunner(
                initialized = { sharedScreenCaptureService != null },
                hasAuthorization = { MediaProjectionHolder.hasAuthorization() },
                capture = { sharedScreenCaptureService?.captureToBase64() },
                screenSize = { resources.displayMetrics.let { it.widthPixels to it.heightPixels } },
            ),
            type = TypeRunner(
                foregroundPkg = cmdForegroundPkg,
                whitelist = cmdWhitelist,
                setTextOnFocusedEditable = { text ->
                    val focus = DouyinCollectService.commandHost()
                        ?.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                    if (focus == null || !focus.isEditable) {
                        null
                    } else {
                        val args = Bundle().apply {
                            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                        }
                        focus.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                    }
                },
            ),
            launch = LaunchRunner(
                whitelist = cmdWhitelist,
                packageExists = { pkg ->
                    try { packageManager.getPackageInfo(pkg, 0); true } catch (e: Exception) { false }
                },
                startLaunch = { pkg ->
                    try {
                        val li = packageManager.getLaunchIntentForPackage(pkg)
                            ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                        if (li == null) {
                            false
                        } else {
                            try {
                                applicationContext.startActivity(
                                    DouyinLaunchTrampoline.buildTrampolineIntentForTarget(applicationContext, li),
                                )
                            } catch (e: Exception) {
                                applicationContext.startActivity(li)
                            }
                            true
                        }
                    } catch (e: Exception) { false }
                },
                foregroundPkg = cmdForegroundPkg,
            ),
            globalAction = { name ->
                val svc = DouyinCollectService.commandHost()
                when {
                    svc == null -> false
                    name == "back" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    else -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                }
            },
            deviceInfo = {
                mapOf(
                    "model" to android.os.Build.MODEL,
                    "manufacturer" to android.os.Build.MANUFACTURER,
                    "androidVersion" to android.os.Build.VERSION.RELEASE,
                    "agentVersion" to BuildConfig.VERSION_NAME,
                    "screenWidth" to resources.displayMetrics.widthPixels,
                    "screenHeight" to resources.displayMetrics.heightPixels,
                )
            },
            treeDump = {
                DouyinCollectService.commandHost()?.rootInActiveWindow?.let { root ->
                    UiTreeSnapshot.serialize(UiTreeSnapshot.fromAccessibilityNode(root))?.let { tree ->
                        mapOf(
                            "tree" to tree,
                            "truncated" to tree.endsWith(UiTreeSnapshot.TRUNCATION_MARK),
                        )
                    }
                }
            },
        )
        commandQueue = CommandQueue(
            scope = scope,
            execute = { req -> executor.execute(req) },
            sendResult = { payload -> wsClient?.sendResult(payload) ?: false },
        )
```

3e. `AgentService.kt` 新增路由函数（routeCollectTask 旁）：

```kotlin
    /** cmd 指令入口：解析→入队。解析失败立即回执（不进队列）。 */
    private fun routeCommand(payload: Map<*, *>, msgId: String?) {
        val dm = resources.displayMetrics
        when (val parsed = com.zenithjoy.agent.command.CommandProtocol.parse(msgId, payload, dm.widthPixels, dm.heightPixels)) {
            is com.zenithjoy.agent.command.ParseOutcome.Ok -> commandQueue?.submit(parsed.request)
            is com.zenithjoy.agent.command.ParseOutcome.Err -> {
                if (msgId != null) {
                    wsClient?.sendResult(
                        com.zenithjoy.agent.command.CommandProtocol.buildResult(
                            msgId,
                            com.zenithjoy.agent.command.CmdOutcome(false, parsed.code, mapOf("detail" to parsed.detail)),
                            null,
                        ),
                    )
                }
            }
        }
    }
```

3f. `onDestroy` 里加 `commandQueue?.close(); commandQueue = null`（sharedScreenCaptureService = null 那段旁边）。

- [ ] **Step 4: Run 全量测试转绿 → commit**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest 2>&1 | tail -5`
Expected: BUILD SUCCESSFUL

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentConfig.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "feat(agent-cmd): AgentService cmd 路由+Runner 生产装配+远程协助开关（绿）"
```

---

### Task 10: 5 入口 lease 拒单守卫（proven-to-fire）

**Files:**
- Modify: `.../collect/DouyinCollectService.kt`（startCollect :204 / startStage2Collect :252）
- Modify: `.../collect/DouyinDmOutreachService.kt`（startOutreach :172）
- Modify: `.../account/DeviceAccountScanService.kt`（startScan :131 / startWarmup :833；shouldRunScan :1162）
- Test: `.../command/CommandLeaseEntryGuardTest.kt`

- [ ] **Step 1: failing test（源码断言=本 bug 类的机器守卫；此测试红→绿的过程就是 proven-to-fire）**

```kotlin
package com.zenithjoy.agent.command

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫（proven-to-fire）：远程指令会话持租约期间，三个无障碍服务的全部任务入口必须拒单。
 * 对抗审查 P0：现有服务只查各自 state 从不消费全局锁——没有这层守卫，
 * 「一机一自动化互斥」在入口处直接被绕过。
 */
class CommandLeaseEntryGuardTest {
    private fun src(path: String) = File("src/main/kotlin/com/zenithjoy/agent/$path").readText()

    private fun assertGuardBefore(source: String, funcName: String, file: String) {
        val funcStart = source.indexOf("fun $funcName(")
        assertTrue("$file 缺少函数 $funcName", funcStart >= 0)
        val window = source.substring(funcStart, minOf(source.length, funcStart + 800))
        assertTrue(
            "$file 的 $funcName 入口必须先问 AutomationLease.isHeldByOther 再动状态",
            window.contains("AutomationLease.isHeldByOther"),
        )
    }

    @Test fun `DouyinCollectService 两个入口有守卫`() {
        val s = src("collect/DouyinCollectService.kt")
        assertGuardBefore(s, "startCollect", "DouyinCollectService")
        assertGuardBefore(s, "startStage2Collect", "DouyinCollectService")
    }

    @Test fun `DouyinDmOutreachService 入口有守卫`() {
        assertGuardBefore(src("collect/DouyinDmOutreachService.kt"), "startOutreach", "DouyinDmOutreachService")
    }

    @Test fun `DeviceAccountScanService 两入口加内部检查点有守卫`() {
        val s = src("account/DeviceAccountScanService.kt")
        assertGuardBefore(s, "startScan", "DeviceAccountScanService")
        assertGuardBefore(s, "startWarmup", "DeviceAccountScanService")
        assertGuardBefore(s, "shouldRunScan", "DeviceAccountScanService")
    }
}
```

- [ ] **Step 2: Run 确认 5 断言全红（= 亲眼见守卫报红）→ commit failing test**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandLeaseEntryGuardTest" 2>&1 | tail -8`
Expected: 3 tests FAIL

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandLeaseEntryGuardTest.kt
git commit -m "test(agent-cmd): 5入口 lease 拒单守卫 failing tests（红=proven-to-fire）"
```

- [ ] **Step 3: 5 个入口函数（+shouldRunScan）开头各加守卫**

每个函数第一行状态变更之前插入（import `com.zenithjoy.agent.command.AutomationLease`；TAG 用各文件自己的）：

```kotlin
        // OpenClaw 信号桥·件1：远程指令会话持租约期间拒单。直接 return 不 ack——
        // 中台 ack 看门狗会重发 dispatch，租约释放（≤120s 无指令自动过期）后任务自然恢复。
        if (AutomationLease.isHeldByOther(AutomationLease.OWNER_NATIVE)) {
            android.util.Log.w(TAG, "task rejected: remote command session holds automation lease")
            return
        }
```

`shouldRunScan`（返回 Boolean 的内部检查点）用 `return false` 变体。

- [ ] **Step 4: Run 转绿（全量不回归）→ commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
git commit -m "feat(agent-cmd): 5任务入口+shouldRunScan lease 拒单守卫（绿）"
```

---

### Task 11: smoke 脚本 + CI 接线

**Files:**
- Create: `.github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh`
- Modify: `.github/workflows/android-agent-ci.yml`（加 smoke step）

- [ ] **Step 1: 写 smoke 脚本（模板：douyin-dm-outreach-android-smoke.sh 的 gradle+XML 断言 + account-scan-trigger-smoke.sh 的 grep 接线）**

```bash
#!/usr/bin/env bash
# agent-cmd-executor-smoke.sh — OpenClaw 信号桥·件1 冒烟
# 1) command 包全部单测通过  2) 关键接线存在（grep 源码级断言）
set -euo pipefail
cd "$(dirname "$0")/../../../.."

AGENT_DIR="services/agent-android"
SRC="$AGENT_DIR/app/src/main/kotlin/com/zenithjoy/agent"

echo "== [1/2] 源码接线断言 =="
grep -q '"cmd"' "$SRC/AgentService.kt" || { echo "FAIL: AgentService 未路由 cmd"; exit 1; }
grep -q 'routeCommand' "$SRC/AgentService.kt" || { echo "FAIL: routeCommand 缺失"; exit 1; }
grep -q 'busyProbe' "$SRC/WsClient.kt" || { echo "FAIL: heartbeat busy 探针缺失"; exit 1; }
if grep -q 'connecting to \$wsUrl' "$SRC/WsClient.kt"; then
  echo "FAIL: WsClient 仍打印含 token 的完整 wsUrl（logcat 泄漏）"; exit 1
fi
grep -q 'AutomationLease.isHeldByOther' "$SRC/collect/DouyinCollectService.kt" || { echo "FAIL: 采集入口无 lease 守卫"; exit 1; }
grep -q 'AutomationLease.isHeldByOther' "$SRC/collect/DouyinDmOutreachService.kt" || { echo "FAIL: 私信入口无 lease 守卫"; exit 1; }
grep -q 'AutomationLease.isHeldByOther' "$SRC/account/DeviceAccountScanService.kt" || { echo "FAIL: 扫描入口无 lease 守卫"; exit 1; }
echo "OK: 接线断言全过"

echo "== [2/2] command 包单测 =="
if [ -z "${ANDROID_HOME:-}" ] && [ ! -d "$HOME/Library/Android/sdk" ] && [ ! -d "/usr/local/lib/android/sdk" ]; then
  echo "SKIP: 无 Android SDK（CI android-agent-ci.yml 会跑全量单测兜底）"
  exit 0
fi
cd "$AGENT_DIR"
./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.command.*" --console=plain 2>&1 | tail -5
RESULTS_DIR="app/build/test-results/testDebugUnitTest"
if grep -rl 'failures="[1-9]' "$RESULTS_DIR" 2>/dev/null | head -1 | grep -q .; then
  echo "FAIL: command 包存在失败用例"; exit 1
fi
echo "OK: agent-cmd-executor smoke 全绿"
```

`chmod +x .github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh`

- [ ] **Step 2: android-agent-ci.yml 在单测 step 之后加**

```yaml
      - name: Agent command executor smoke（OpenClaw 信号桥·件1）
        run: bash .github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh
```

- [ ] **Step 3: 本地跑 smoke 验证 → commit（[CONFIG] 前缀：改 CI workflow）**

Run: `bash .github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh`
Expected: `OK: 接线断言全过` + 单测段 OK 或 SKIP

```bash
git add .github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh .github/workflows/android-agent-ci.yml
git commit -m "[CONFIG] ci(agent-cmd): 件1 smoke 脚本进 android CI"
```

---

### Task 12: 收尾自检

- [ ] 全量测试：`cd services/agent-android && ./gradlew :app:testDebugUnitTest 2>&1 | tail -5` → BUILD SUCCESSFUL
- [ ] `git log --oneline` 确认红绿 commit 成对
- [ ] 清理：无新增 TODO/console 调试残留（`git diff e7bd5ce2..HEAD | grep -i "TODO\|println" || true` 应为空）
- [ ] push + 开 PR：标题 `feat(agent-android): OpenClaw 信号桥·件1——统一指令处理器（8 动作原语+租约互斥+回执协议）`；正文声明 GP 锚 `line02/keyword_acquisition keep-green`、Brain task `5b8d0139`、决策 `7a4c0369`，PR body 结尾按仓库规范
