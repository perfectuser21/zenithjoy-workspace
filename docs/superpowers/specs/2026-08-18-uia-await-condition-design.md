# agent-android 无障碍等待模式统一（快照式假设 → 条件式等待）

**Bug**：Brain task 2b66aecf-9217-4d3d-8819-1876e95713d9 ｜ decision d1ec2a78-b613-45c7-ad4c-24f7cbc4341b
**GP-Anchor**：line02/keyword_acquisition keep-green
**base_sha**：aca1c968a32be63f81522f646c8eb5f5633c11f9

---

## 1. 为什么这是架构级修复，而不是第四次单点补丁

错误码 `NO_SEARCH_INPUT` 在 main 里已被修过三次，每次 commit 都写「根治」，每次修的都是不同位置：

| PR | 修了什么 | 层面 |
|---|---|---|
| #1120 | 点击搜索按钮**后**重新抓 root，不再用点击前旧快照 | 点击后 |
| #1375 | 直调 typeKeyword **前**补 state 守卫，防与事件驱动路径重复 | 状态竞态 |
| #1640 | 荣耀 iAware 拦后台拉起 → DouyinLaunchTrampoline | 启动方式 |
| **本次** | 搜索按钮**根本还没出现**时就去找它 | **点击前** |

systematic-debugging 的判据：3+ 次修复各自揭示不同位置的新问题 = 架构问题。共用的错误假设是：

> `rootInActiveWindow != null` 等于「目标页面已就绪」

它不等于。抖音闪屏页、荣耀系统管家 `AppSplashAdvertiseActivity` 开屏广告页，都满足 `!= null`。

### 更强的证据：同一个正确模式已被独立发明三次

| 位置 | 形态 | 等的条件 |
|---|---|---|
| `DouyinDmOutreachService.awaitDouyinForeground()` | 轮询前台包名 + 消厂商弹窗 | 前台是抖音 |
| `DouyinDmOutreachService.awaitNode(finder)` | 泛型轮询直到 finder 命中 | 任意指定节点 |
| `DeviceAccountScanService.awaitSwitchAccountPanel()` | 轮询直到 recycler_view 出现 | 切号面板 |

account-scan 那处的注释把根因写得一字不差：

> 那个函数语义是"等任意非 null 根节点出现"就立即返回，**不等 recycler_view 这个特定元素真正渲染完成**，面板展开动画/加载较慢时检查过早，误判"面板未出现"

三个服务各自撞上同一个根因、各自在自己那处修好、谁也没有把它变成共享设施——于是 collect 的 stage1 主链路成了漏网的那条。**本次要做的就是把这个模式变成唯一设施，并让所有调用点用它。**

---

## 2. 根因与真机证据

三个 Service 各有一份同样的：

```kotlin
private suspend fun awaitRootInActiveWindow(attempts: Int = 8, intervalMs: Long = 500L): AccessibilityNodeInfo? {
    repeat(attempts) { delay(intervalMs); rootInActiveWindow?.let { return it } }
    return rootInActiveWindow          // ← 超时还兜底返回，可能是过期/错误页面的 root
}
```

两个缺陷：
1. **等待条件是「有窗口」而非「目标就绪」**——第一次 delay(500) 后就返回。
2. **超时兜底返回而非明确失败**——`DouyinCollectService:415` 的注释已记载它的危害：「超时兜底甚至会退回点击前、必然没有搜索框的旧 root」。

### 真机 A/B 对照（小粉 ANY-AN00 / 荣耀 X30 / Android 13 / 抖音 40.0.0）

| 组 | 条件 | 结果 |
|---|---|---|
| A | 抖音进程已热 | `11:09:03 openSearchBar: searchBtn=true` → `cards=3` → 终态 `stage_1_done` ✅ |
| B | force-stop 冷启动 | `10:42:48 openSearchBar: searchBtn=false` → `NO_SEARCH_INPUT` → `KEYWORD_NO_RESULT` ❌ |

同设备、同 agent、同选择器，**差别只在时机**。

抖音稳定首页后 uiautomator dump（271 节点）实证目标节点存在：
`class="android.widget.Button" content-desc="搜索" clickable="true"`
→ **所有选择器不许动**，本次只改「什么时候去找」。

机型对照排除版本因素：第四台 MAA-AN00/Android 16 抖音同为 40.0.0，因启动快碰巧通过——这就是 nightly「时好时坏」的结构性来源。

---

## 3. 架构

### 3.1 新增共享设施

新建 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/uia/NodeAwait.kt`（新包 `uia`，中性位置，`collect` 与 `account` 两个包都可 import）。

分两层，**只有纯逻辑层进单测**：

**第一层：纯轮询核心（JVM 可测，不碰 Android 框架）**

```kotlin
package com.zenithjoy.agent.uia

/** 单次探测的快照：目标值 + 用于事后诊断的环境信息。 */
data class ProbeSnapshot<T : Any>(
    val target: T?,
    val rootPresent: Boolean,
    val foregroundPkg: String?,
)

/** 轮询结果：命中值 + 实际轮询次数 + 全程观察到的环境事实。 */
data class PollOutcome<T : Any>(
    val value: T?,
    val attempts: Int,
    val everSawRoot: Boolean,
    val lastForegroundPkg: String?,
) {
    val hit: Boolean get() = value != null
    fun waitedMs(intervalMs: Long): Long = (attempts - 1).coerceAtLeast(0) * intervalMs
}

/** 失败分类——让下一次真机排查不必再考古。 */
enum class WaitFailure { NO_ROOT, WRONG_FOREGROUND, TARGET_ABSENT }

object NodeAwait {

    /**
     * 轮询直到 probe 给出非空 target 或用尽 maxAttempts。
     * 语义：**先 probe，未命中再 sleep**（页面已就绪时零额外延迟）。
     * 超时返回 value=null——**绝不兜底返回可能过期的快照**（对比旧 awaitRootInActiveWindow 的 return rootInActiveWindow）。
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
     * 把失败归到三类之一：
     * - NO_ROOT          全程没拿到根节点（无障碍被撤销/服务未绑定）
     * - WRONG_FOREGROUND 拿到了根节点但前台始终不是期望包（厂商开屏广告/系统弹窗盖住）
     * - TARGET_ABSENT    前台就是期望包，但目标节点始终没出现（页面没加载完/结构变了）
     */
    fun classifyFailure(outcome: PollOutcome<*>, expectedPkg: String?): WaitFailure = when {
        !outcome.everSawRoot -> WaitFailure.NO_ROOT
        expectedPkg != null && outcome.lastForegroundPkg != expectedPkg -> WaitFailure.WRONG_FOREGROUND
        else -> WaitFailure.TARGET_ABSENT
    }
}
```

**第二层：AccessibilityService 扩展壳（薄，不单测）**

```kotlin
/**
 * 在本 Service 的活动窗口上轮询等待 finder 命中的节点。
 * expectedPkg 非空时，同时把「前台包名」记进诊断（不阻断——某些步骤本来就允许跨包）。
 */
suspend fun AccessibilityService.awaitNode(
    maxAttempts: Int,
    intervalMs: Long,
    expectedPkg: String? = null,
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

### 3.1.1 等「状态成立」而不只是等「节点出现」

有的调用点等的不是某个节点出现，而是某个**状态成立**——例如 dm `:262` 的回执判定等的是「输入框已清空」（`isInputCleared(root, message)`）。原语的 `finder` 是 `(AccessibilityNodeInfo) -> AccessibilityNodeInfo?`，这类场景把 root 自身作为命中值即可：

```kotlin
awaitNode(maxAttempts = 8, intervalMs = 500, expectedPkg = DOUYIN_PKG) { root ->
    root.takeIf { isInputCleared(it, message) }
}
```

这是 `takeIf` 的常规用法，`DeviceAccountScanService.awaitSwitchAccountPanel` 现有实现（`checkRoot?.takeIf { findNodeByIds(it, "…recycler_view") != null }`）已经是同一写法——**无需为此扩展原语签名**。

### 3.2 修掉现有 `awaitNode` 的嵌套超时缺陷

dm 现有的 `awaitNode` 内部调用 `awaitRootInActiveWindow()`（自带 8×500ms），于是每一轮外层 attempt 里还嵌一层最多 4 秒的等待，实际耗时是 `maxAttempts × (最多 4s)` 而非 `maxAttempts × delayMs`——真实上限不可控且远超设计意图。新原语直接读 `rootInActiveWindow`，只有一层轮询，耗时严格等于 `maxAttempts × intervalMs`。

### 3.3 不做的事（YAGNI）

三个 Service 各有一份 `findNodeByContentDesc` / `findNodeByIds` / `findNodeByText` 等工具函数（重复但行为一致）。**本次不收敛它们**：没有 bug 驱动、会让 diff 面积翻倍、且会把回归风险扩散到与本 bug 无关的路径。原语只负责「什么时候找」，「怎么找」维持各 Service 现状。

---

## 4. 逐调用点迁移清单

共 16 个真实调用点（其余 grep 命中是定义与注释）+ 3 个既有辅助函数改为委托。
分布：collect 4 处、dm 9 处、account-scan 3 处；另有 dm 的 `:430`/`:536` 两处判定为不迁移（理由见 §4.2）。

### 4.1 `DouyinCollectService.kt`（4 处）

| 行 | 当前拿 root 后要什么 | 迁移后等的条件 | 上限 | 失败错误码 |
|---|---|---|---|---|
| :385 `openSearchBar` | 找 `content-desc="搜索"` 按钮 | **该按钮出现** ← 本 bug | 24×500ms=12s | `NO_ROOT`→`NO_WINDOW`；`WRONG_FOREGROUND`/`TARGET_ABSENT`→`NO_SEARCH_INPUT` |
| :411 点击搜索按钮后 | 找搜索输入框 | **输入框出现** | 8×500ms=4s | 保持现状（state 守卫已接管，见 §6） |
| :725 tap 卡片后 | 详情页找分享按钮 | **分享按钮出现** | 12×500ms=6s | `STEP1_detailRoot_null` 细化为三态 |
| :1117 `resolveDouyinIdForCommenter` | 评论面板找头像/昵称 | **昵称节点出现** | 8×500ms=4s | 返回 null（尽力而为，不变） |

### 4.2 `DouyinDmOutreachService.kt`（8 处 + 1 委托）

| 行 | 要什么 | 等的条件 | 上限 | 失败错误码 |
|---|---|---|---|---|
| :192 | dm 入口按钮 | 入口按钮出现 | 12×500ms | `NO_WINDOW` 细化三态 |
| :231 | 点 dm 后的输入框 | 输入框出现 | 12×500ms | `NO_WINDOW_AFTER_DM_CLICK` 细化 |
| :246 | 发送按钮 | 发送按钮出现 | 8×500ms | 现状回退 `postClickRoot` 改为明确失败 |
| :262 | 回执（输入框已清空） | 输入框清空 | 8×500ms | `NO_RECEIPT_CONFIRMED`（不变） |
| :362 | 搜索按钮 | 搜索按钮出现 | 24×500ms | `NO_WINDOW_BEFORE_SEARCH` 细化 |
| :376 | 搜索输入框 | 输入框出现 | 8×500ms | 保持 |
| :399 | 搜索确认按钮 | 确认按钮出现 | 8×500ms | 保持 |
| :415 | 结果页 | 结果页特征节点出现 ⚠️见下 | 12×500ms | `NO_SEARCH_RESULTS_WINDOW` 细化 |
| :437 | 主页 | 主页特征节点出现 | 12×500ms | `NO_PROFILE_WINDOW` 细化 |
| :603 `awaitNode` | — | **改为委托共享原语**（顺带修掉 §3.2 的嵌套超时） | — | — |

⚠️ **`:415` 的等待条件有陷阱**：该处代码注释记载「抖音 39.4.0 真机实测：SearchResultActivity 的搜索结果列表**不进无障碍树**（自定义/Lynx 渲染）」。因此等待条件**不得**设为「结果列表项出现」——那个节点在无障碍树里永远不会有。实现时必须沿用该处代码当前实际依赖的可见锚点（页面容器/tab 等），并在真机上确认该锚点确实会出现；拿不准就保持该处现有判定逻辑不变、只把「拿 root」这一步换成轮询。

`:430`（裸调用不取返回值）与 `:536`（纯诊断取文本）**不迁移**——前者语义是「给页面一点时间」，后者只为打日志，改动无收益。

### 4.3 `DeviceAccountScanService.kt`（3 处 + 1 委托）

| 行 | 要什么 | 等的条件 | 上限 | 失败错误码 |
|---|---|---|---|---|
| :324 | 「我」tab 节点 | 该 tab 出现 | 12×500ms | 现状返回 null（不变） |
| :411 `awaitSwitchAccountPanel` | recycler_view | **改为委托共享原语**（行为等价，4×800ms 保持） | — | — |
| :569 | 昵称列表 | 至少一个 `tv_nickname` 出现 | 8×500ms | 返回 null（不变） |
| :707 | 面板中指定昵称行 | 该昵称行出现 | 8×500ms | 返回 false（不变） |

### 4.4 超时预算核对

单步最长 12s（两处 24×500ms 的搜索入口等待），与既有链路预算相容：

| 既有预算 | 值 | 本次新增单步上限 | 是否相容 |
|---|---|---|---|
| `SUBMIT_SEARCH_TIMEOUT_MS` | 15s | 12s（:385） | ✅ 留 3s 余量 |
| `PER_CARD_TIMEOUT_MS` | 25s | 6s（:725） | ✅ |
| `VIDEO_OPEN_TIMEOUT_MS` | 15s | — | ✅ 不涉及 |
| `PER_LEAD_ENRICH_TIMEOUT_MS` | 20s | 4s（:1117） | ✅ |
| dm lead 90s 熔断 | 90s | dm 各步累计最坏 ≈ 44s | ✅ |

**没有任何一处等待可能突破其所在链路的总预算。**

---

## 5. 错误路径与诊断

每个迁移点超时后统一打印：

```
<步骤名>: 等待超时 attempts=<n> waitedMs=<ms> failure=<NO_ROOT|WRONG_FOREGROUND|TARGET_ABSENT> fgPkg=<包名>
```

三态的现实含义与下一步动作：

| 分类 | 现实含义 | 排查方向 |
|---|---|---|
| `NO_ROOT` | 无障碍服务被撤销/未绑定 | 查 `settings get secure enabled_accessibility_services`；force-stop 后常见 |
| `WRONG_FOREGROUND` | 厂商开屏广告/系统弹窗盖住抖音 | 查 `dumpsys activity activities`；本次实测过 `com.hihonor.systemmanager/…AppSplashAdvertiseActivity` |
| `TARGET_ABSENT` | 前台确是抖音但节点没出现 | 页面没加载完（加大上限）或抖音改版（选择器需更新） |

这解决了本次排查最费时的那一段——旧日志只有 `searchBtn=false`，无法区分「没窗口」「窗口不是抖音」「抖音但没加载完」，只能靠人去 dumpsys + 截图考古。

---

## 6. 与既有事件驱动路径共存

真机日志实证存在：`openSearchBar: 跳过直调 typeKeyword，state=SUBMITTING_SEARCH 已被事件驱动路径推进`——即 #1375 引入的 state 守卫（`shouldEnterSubmitting`）。

`onAccessibilityEvent` 驱动的状态机与本次的轮询是**互补而非竞争**：

- 轮询解决「目标节点还没出现就动手」（本 bug）
- state 守卫解决「事件驱动路径已抢先完成，直调路径不该重复动手」（#1375）

**约束**：迁移 `:411` 时不得移动或绕过 `shouldEnterSubmitting(state)` 判断，其相对位置保持不变——轮询只替换「怎么拿到 postClickRoot」，不触碰其后的状态判断。轮询期间事件驱动路径若已把 state 推走，`shouldEnterSubmitting` 照旧短路，行为与今天一致。

---

## 7. 测试策略

### 7.1 unit 档（主体，进 CI）

放 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/uia/NodeAwaitTest.kt`，沿用既有 `DouyinCollectServiceStateTest.kt` 风格（纯 JUnit；`kotlinx.coroutines.test` 依赖已在 `app/build.gradle.kts:83`）。

`pollUntilPresent` 的 `sleep` 与 `probe` 均可注入 → 无需真实时间、无需 Android 框架。

| # | 场景 | 断言 |
|---|---|---|
| 1 | 前 3 次无目标、第 4 次出现 | `hit=true`、`attempts==4`（证明不早退也不多轮） |
| 2 | 始终不出现 | `value==null`、`attempts==maxAttempts` |
| 3 | 首次即命中 | `attempts==1` **且 sleep 调用 0 次**（证明热路径零延迟） |
| 4 | probe 中途 `rootPresent=false` | 不崩、继续轮询、`everSawRoot` 反映曾见过 |
| 5 | 全程无 root | `classifyFailure == NO_ROOT` |
| 6 | 有 root 但前台始终是别的包 | `classifyFailure == WRONG_FOREGROUND` 且 `lastForegroundPkg` 为该包 |
| 7 | 前台是期望包但目标never出现 | `classifyFailure == TARGET_ABSENT` |
| 8 | `waitedMs` 计算 | `attempts=4, interval=500` → `1500`（3 次间隔，非 4 次） |

**每条 proven-to-fire**：实现完成后逐条故意弄坏一次（如把 `if (attempts < maxAttempts) sleep(...)` 改成无条件 sleep 看 #3 报红），亲眼见红再恢复。

### 7.2 真机 E2E（手动，非 CI）

本次动了全部三个 Service，**三条链路都要重验**：

| 链路 | 设备 | 判据 |
|---|---|---|
| 采集 collect | 小粉 `192.168.3.9:5555`（复现机） | 冷启动（force-stop 抖音）跑 smoke → `searchBtn=true` → `cards>0` → 终态非 `KEYWORD_NO_RESULT` |
| 私信 dm | 小黄 `192.168.3.236:5555` | `dm-send-realmachine-smoke.sh` → `outcome=SENT`，EXIT=0（08-17 刚验过，属回归重点） |
| 账号扫描 account-scan | 小粉或小黄 | 扫描返回账号数 ≥1，无 `面板未出现` 误判 |

**冷启动是必须条件**——热启动跑不出这个 bug（A/B 实验已证）。

### 7.3 不做的档

integration 档跳过：无障碍服务无法在 JVM/Robolectric 下真实驱动抖音；这一层的价值由真机 E2E 覆盖。

---

## 8. 验收标准

- [ ] commit-1 failing test（先跑一遍见红），commit-2 实现，顺序不颠倒
- [ ] `NodeAwaitTest` 8 条全绿，且每条 proven-to-fire 过
- [ ] 16 个调用点全部迁移，`awaitRootInActiveWindow` 在三个 Service 中不再被业务路径直接调用（保留与否见实现，但不得再有「拿到 root 直接 findNode 判死」的写法）
- [ ] 三条真机链路各自 PASS（采集必须冷启动复现场景下 PASS）
- [ ] CI 全绿
- [ ] agent versionName/versionCode 已 bump（改了 agent 代码）

---

## 9. 不在范围

判定链 flaky（3 视频 pending / media_projection null）｜四台 agent 版本统一升级｜抓评论的抖音小号绑定（`NO_HEADFUL_CHROME`，需人工登录 rog 的 Chrome）｜把 `e2e-line02-android-collect` workflow 升 required gate｜设备侧 `persist.log.tag=S` 静音（已 `setprop persist.log.tag V` 修好，属设备配置）｜三个 Service 的 `findNodeBy*` 工具函数收敛（见 §3.3）
