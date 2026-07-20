# Android Agent 重启服务按钮注册重试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Android Agent 的"重启 Agent 服务"按钮（以及任何系统触发的 `onStartCommand`）在尚未成功注册时，能真正重试 `register()`，不再需要用户强杀 App 进程才能重试。

**Architecture:** 把注册逻辑从 `initAgent()`（只跑一次，守着 WS/心跳轮询 loop 的初始化）中抽成独立的 `performRegister()`，用一个新的、与 `agentInitialized` 完全独立的 `registerRetryInFlight` 标志位防并发，纯决策逻辑 `shouldRetryRegister()` 放进伴生对象保持可单元测试（对齐仓库里 `shouldRunInitAgent` 的既有模式）。

**Tech Stack:** Kotlin, Android Service, JUnit4（`app/src/test/kotlin`，无 Robolectric/Mockito）。

---

## File Structure

- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
  - 新增伴生对象纯函数 `shouldRetryRegister`
  - 新增实例字段 `registerRetryInFlight`
  - 把 `initAgent()` 里注册那一段抽成 `performRegister()`，`initAgent()` 改为调用它
  - `onStartCommand` 补一个 `else if` 分支
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceRegisterRetryTest.kt`（新建）

---

### Task 1: 纯函数 `shouldRetryRegister` + 失败测试

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt:989`（`shouldRunInitAgent` 定义处，紧邻插入新函数）
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceRegisterRetryTest.kt`

- [ ] **Step 1: 写失败测试**

创建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceRegisterRetryTest.kt`：

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机复现(2026-07-20)：AgentService.agentInitialized 一次性标志位把 register() 锁死在
 * Service 首次 onStartCommand 里——staging License 配额修好后，用户点"重启 Agent 服务"
 * 按钮，10 分钟内服务器 /api/agent/register 与 ws hello 日志零新请求，证明按钮点击完全
 * 没有触发任何重试。shouldRetryRegister 是独立于 shouldRunInitAgent 的重试决策：只要还
 * 没注册成功、且没有另一次重试正在进行，就应该重试。
 */
class AgentServiceRegisterRetryTest {

    @Test
    fun `not registered and no retry in flight should retry`() {
        assertTrue(
            AgentService.shouldRetryRegister(isRegistered = false, retryInFlight = false)
        )
    }

    @Test
    fun `already registered should not retry`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = true, retryInFlight = false)
        )
    }

    @Test
    fun `retry already in flight should not start another`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = false, retryInFlight = true)
        )
    }

    @Test
    fun `already registered and retry in flight should not retry`() {
        assertFalse(
            AgentService.shouldRetryRegister(isRegistered = true, retryInFlight = true)
        )
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent-android && gradle :app:testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceRegisterRetryTest"`
Expected: FAIL —— `AgentService.shouldRetryRegister` 编译不存在（unresolved reference）

- [ ] **Step 3: 实现最小代码**

在 `AgentService.kt` 的伴生对象里，紧邻 `shouldRunInitAgent`（约第 989 行）插入：

```kotlin
        // register 重试守卫：与 agentInitialized（只管 WS/心跳轮询 loop 初始化）完全独立。
        // 只要还没注册成功、且没有另一次重试正在进行中，任何一次 onStartCommand 交付
        // （按钮点击或系统重启 Service）都应该重试注册——不需要杀进程重开 App。
        internal fun shouldRetryRegister(isRegistered: Boolean, retryInFlight: Boolean): Boolean =
            !isRegistered && !retryInFlight
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent-android && gradle :app:testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceRegisterRetryTest"`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt \
        services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceRegisterRetryTest.kt
git commit -m "test(android): shouldRetryRegister 决策逻辑+失败测试"
```

---

### Task 2: 抽出 `performRegister()`，接入 `onStartCommand` 重试路径

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt:65`（字段区，`agentInitialized` 旁）
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt:257-275`（`onStartCommand`）
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt:295-335`（`initAgent()` 注册段）

- [ ] **Step 1: 新增 `registerRetryInFlight` 字段**

在 `AgentService.kt:65` 附近（`@Volatile private var agentInitialized = false` 那一行之后）插入：

```kotlin
    // register 重试进行中标志：防止同一时刻并发触发多个 performRegister() 协程
    // （onStartCommand 可能因系统重启 Service 而短时间内多次交付）。
    @Volatile private var registerRetryInFlight = false
```

- [ ] **Step 2: 把 `initAgent()` 里的注册段抽成 `performRegister()`**

把 `AgentService.kt:295-335`（`initAgent()` 函数体里，从 `// License 注册（复用 POST /api/agent/register）` 注释开始，到闭合 `if (!config.isRegistered) { ... } else { ... }` 块结束，即原第 306-335 行）整体剪切，替换为一个新的独立函数，并在 `initAgent()` 原位置改为调用它：

`initAgent()` 内原来这一段：

```kotlin
        // License 注册（复用 POST /api/agent/register）
        if (!config.isRegistered) {
            android.util.Log.i(TAG, "registering with license...")
            val registrar = AgentRegistrar()
            val registerRequest = AgentRegistrar.RegisterRequest(
                licenseKey = config.licenseKey,
                machineId = config.machineId,
                hostname = android.os.Build.MODEL,
                agentId = config.agentId,
                version = BuildConfig.VERSION_NAME,
                httpBase = config.deriveHttpBase(),
            )
            when (val outcome = withContext(Dispatchers.IO) { registrar.register(registerRequest) }) {
                is AgentRegistrar.RegisterOutcome.Success -> {
                    val result = outcome.result
                    config.wsToken = result.wsToken
                    config.machineId = result.machineId
                    if (!result.tier.isNullOrEmpty()) config.tier = result.tier
                    if (!result.agentUuid.isNullOrEmpty()) config.agentUuid = result.agentUuid
                    config.lastRegisterError = ""
                    android.util.Log.i(TAG, "registered — tier=${config.tier} uuid=${config.agentUuid}")
                }
                is AgentRegistrar.RegisterOutcome.Failure -> {
                    config.lastRegisterError = outcome.reason
                    android.util.Log.w(TAG, "registration failed: ${outcome.reason} — continuing with license key fallback")
                }
            }
        } else {
            android.util.Log.i(TAG, "already registered, skipping")
        }
```

替换为：

```kotlin
        // License 注册（复用 POST /api/agent/register）
        performRegister()
```

紧接在 `private suspend fun initAgent() { ... }` 函数结束的闭合大括号之后（原第 395 行之后，`initAgent()` 函数体末尾），新增独立函数：

```kotlin
    /**
     * 注册一次（复用 POST /api/agent/register）。从 initAgent() 抽出，使其能独立于
     * agentInitialized 被重复调用——register 失败后（如撞 License 装机配额上限），
     * 后续 onStartCommand（重启按钮/系统重启 Service）能真正重试，不需要杀进程重开。
     */
    private suspend fun performRegister() {
        if (config.isRegistered) {
            android.util.Log.i(TAG, "already registered, skipping")
            return
        }
        android.util.Log.i(TAG, "registering with license...")
        val registrar = AgentRegistrar()
        val registerRequest = AgentRegistrar.RegisterRequest(
            licenseKey = config.licenseKey,
            machineId = config.machineId,
            hostname = android.os.Build.MODEL,
            agentId = config.agentId,
            version = BuildConfig.VERSION_NAME,
            httpBase = config.deriveHttpBase(),
        )
        when (val outcome = withContext(Dispatchers.IO) { registrar.register(registerRequest) }) {
            is AgentRegistrar.RegisterOutcome.Success -> {
                val result = outcome.result
                config.wsToken = result.wsToken
                config.machineId = result.machineId
                if (!result.tier.isNullOrEmpty()) config.tier = result.tier
                if (!result.agentUuid.isNullOrEmpty()) config.agentUuid = result.agentUuid
                config.lastRegisterError = ""
                android.util.Log.i(TAG, "registered — tier=${config.tier} uuid=${config.agentUuid}")
            }
            is AgentRegistrar.RegisterOutcome.Failure -> {
                config.lastRegisterError = outcome.reason
                android.util.Log.w(TAG, "registration failed: ${outcome.reason} — continuing with license key fallback")
            }
        }
    }
```

> 注意：`performRegister()` 内联了原来 `if (!config.isRegistered) {...} else {...}` 的判断（提前 return），语义与原代码完全一致，只是换成函数入口守卫。`machineId`/`agentId` 计算（`initAgent()` 里紧邻注册段之前的两个 `if (...isEmpty())` 块，原第 296-304 行）**保留在 `initAgent()` 里不动**——`performRegister()` 依赖它们已经算好，因为它也会被 `onStartCommand` 的重试分支直接调用（此时 `initAgent()` 已经跑过一次，`machineId`/`agentId` 必然已经算好）。

- [ ] **Step 3: 编译确认无残留引用错误**

Run: `cd services/agent-android && gradle :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: `onStartCommand` 接入重试分支**

把 `AgentService.kt:257-275` 的 `onStartCommand` 从：

```kotlin
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!config.isConfigured) {
            android.util.Log.w(TAG, "licenseKey not set — agent cannot start")
            stopSelf()
            return START_NOT_STICKY
        }
        // 用户可能在服务已运行期间才在 MainActivity 完成 MediaProjection 授权（先「启动
        // Agent」跳过截屏授权，后来又点「授权截屏」）。startForeground 可重复调用以更新
        // type，这里重跑一次把已授权的服务从纯 DATA_SYNC 升级到 DATA_SYNC|MEDIA_PROJECTION，
        // 不需要重启整个服务。
        startForegroundCompat()
        // 真机复现(2026-07-10)：lastStartId=3 → initAgent 跑了 3 次，泄漏 3 套轮询
        // loop（旧 loop 只在 onDestroy 停），同一任务每周期被投递 N 次。只初始化一次。
        if (shouldRunInitAgent(agentInitialized)) {
            agentInitialized = true
            scope.launch { initAgent() }
        }
        return START_STICKY
    }
```

改为：

```kotlin
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!config.isConfigured) {
            android.util.Log.w(TAG, "licenseKey not set — agent cannot start")
            stopSelf()
            return START_NOT_STICKY
        }
        // 用户可能在服务已运行期间才在 MainActivity 完成 MediaProjection 授权（先「启动
        // Agent」跳过截屏授权，后来又点「授权截屏」）。startForeground 可重复调用以更新
        // type，这里重跑一次把已授权的服务从纯 DATA_SYNC 升级到 DATA_SYNC|MEDIA_PROJECTION，
        // 不需要重启整个服务。
        startForegroundCompat()
        // 真机复现(2026-07-10)：lastStartId=3 → initAgent 跑了 3 次，泄漏 3 套轮询
        // loop（旧 loop 只在 onDestroy 停），同一任务每周期被投递 N 次。只初始化一次。
        if (shouldRunInitAgent(agentInitialized)) {
            agentInitialized = true
            scope.launch { initAgent() }
        } else if (shouldRetryRegister(config.isRegistered, registerRetryInFlight)) {
            // 真机复现(2026-07-20)：register 失败后（如撞配额上限），agentInitialized 已
            // 为 true，initAgent() 不会再跑，register() 也就永远没有第二次机会——"重启
            // Agent 服务"按钮点了等于白点。这里独立于 agentInitialized 重试注册，不重新
            // 初始化 WS/心跳轮询 loop（避免重新触发 2026-07-10 那个泄漏）。
            registerRetryInFlight = true
            scope.launch {
                try {
                    performRegister()
                } finally {
                    registerRetryInFlight = false
                }
            }
        }
        return START_STICKY
    }
```

- [ ] **Step 5: 跑全量单测确认无回归**

Run: `cd services/agent-android && gradle :app:testDebugUnitTest`
Expected: BUILD SUCCESSFUL，所有既有测试（含 `AgentServiceInitGuardTest`、`AgentServiceRegisterRetryTest`）全绿

- [ ] **Step 6: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
git commit -m "fix(android): 重启Agent服务按钮真正重试register，不再需要杀进程重开

真机复现：staging License配额修好后点重启按钮，10分钟服务器日志零新register/ws
hello请求。根因是register()嵌套在只跑一次的initAgent()里，被agentInitialized
标志位永久锁死。抽出performRegister()独立于该标志位，用registerRetryInFlight防
并发，onStartCommand未初始化分支之外新增重试分支。"
```

---

## Self-Review Checklist（执行者完成全部 Task 后自查）

- [ ] `shouldRetryRegister` 的 4 种真值组合均有测试覆盖
- [ ] `performRegister()` 与原 `initAgent()` 内联逻辑行为完全一致（成功/失败分支、日志文案）
- [ ] `initAgent()` 里 `machineId`/`agentId` 计算逻辑未被误删或误移
- [ ] `onStartCommand` 两个分支（`shouldRunInitAgent` / `shouldRetryRegister`）互斥，不会同一次 `onStartCommand` 内重复触发注册
- [ ] `gradle :app:testDebugUnitTest` 全绿
