# 抖音采集取链剪贴板路线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把抖音采集 Stage1 取链从证伪的 share-intent 路线改为剪贴板路线（点「分享链接」→ 透明 Activity 前台焦点读剪贴板 → 抽短链上报），拿到真实 video_id。

**Architecture:** agent 端为主：ShareIngestActivity 新增剪贴板读取模式（onWindowFocusChanged 后读+轮询+自杀超时+token 回投），DouyinCollectService.captureShareUrlForCard 重写为「点分享链接+清基线+透明页读取+三层新鲜度校验」，判定逻辑抽进可 JVM 单测的 ClipboardCaptureGate。服务端仅同步一处正则。绝不造假 id 原则不变。

**Tech Stack:** Kotlin（Android 无障碍服务 + JUnit4 JVM 单测）、TypeScript（apps/api vitest）。

## Global Constraints

- agent versionCode 4→5，versionName 2.1.0→2.1.1（services/agent-android/app/build.gradle.kts:14-15）
- 绝不造假 video_id：任一步失败该卡跳过，全失败 ALL_SHARE_FAILED
- ClipboardCaptureGate 为纯 Kotlin object，禁用 `android.util.Log` 及任何 Android API（JVM 单测 not mocked）
- 短链正则 agent 与服务端两处**必须完全一致**：`https?://v\.douyin\.com/(?:i/)?[A-Za-z0-9]+/?`
- ShareIngestActivity 新增 Intent extra 用独立常量 `EXTRA_INGEST_MODE`/`EXTRA_INGEST_TOKEN`，勿复用 DouyinCollectService.EXTRA_MODE
- TDD 铁律：每任务 commit-1 failing test，commit-2 实现；顺序不可颠倒
- RandomDelay 提供操作间隔，禁止裸固定常量 delay

---

### Task 1: 短链正则放宽 /i/ 变体（agent + 服务端两处同步）

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ShareLinkExtractor.kt:10`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/ShareLinkExtractorTest.kt`
- Modify: `apps/api/src/services/douyin-share-resolver.ts:48`
- Test: `apps/api/src/services/douyin-share-resolver.test.ts`

**Interfaces:**
- Produces: `ShareLinkExtractor.extract(text: String?): String?` 与服务端 `extractShareUrl` 均识别 `v.douyin.com/i/<code>/` 形态

- [ ] **Step 1: 写 agent 端 failing 测试**

在 ShareLinkExtractorTest.kt 追加：
```kotlin
    // TC-S06: 抽出带 /i/ 路径段的短链变体
    @Test
    fun `extracts short link with i path segment`() {
        val text = "复制打开抖音 https://v.douyin.com/i/AbC123/ 看看"
        assertEquals("https://v.douyin.com/i/AbC123/", ShareLinkExtractor.extract(text))
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*ShareLinkExtractorTest"`
Expected: FAIL（当前正则 `[A-Za-z0-9]+` 抽到 `https://v.douyin.com/i` 不含后续段）

- [ ] **Step 3: 放宽 agent 正则**

ShareLinkExtractor.kt 第 10 行：
```kotlin
    private val SHORT_LINK = Regex("""https?://v\.douyin\.com/(?:i/)?[A-Za-z0-9]+/?""")
```

- [ ] **Step 4: 跑 agent 测试确认通过**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*ShareLinkExtractorTest"`
Expected: PASS（含 TC-S01~S06）

- [ ] **Step 5: 写服务端 failing 测试**

在 douyin-share-resolver.test.ts 的 extractShareUrl 描述块追加（照现有用例风格）：
```typescript
  it('extracts short link with /i/ path segment', () => {
    expect(extractShareUrl('打开抖音 https://v.douyin.com/i/AbC123/ 看')).toBe('https://v.douyin.com/i/AbC123/');
  });
```

- [ ] **Step 6: 跑服务端测试确认失败**

Run: `cd apps/api && npx vitest run src/services/douyin-share-resolver.test.ts`
Expected: FAIL（收到 `https://v.douyin.com/i`）

- [ ] **Step 7: 服务端正则同步**

douyin-share-resolver.ts 第 48 行：
```typescript
  const m = text.match(/https?:\/\/v\.douyin\.com\/(?:i\/)?[A-Za-z0-9]+\/?/);
```

- [ ] **Step 8: 跑服务端测试确认通过**

Run: `cd apps/api && npx vitest run src/services/douyin-share-resolver.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ShareLinkExtractor.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/ShareLinkExtractorTest.kt apps/api/src/services/douyin-share-resolver.ts apps/api/src/services/douyin-share-resolver.test.ts
git commit -m "feat(collect): 短链正则支持 /i/ 路径变体（agent+服务端同步）"
```

---

### Task 2: ClipboardCaptureGate 纯函数判定 object + 单测

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ClipboardCaptureGate.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/ClipboardCaptureGateTest.kt`

**Interfaces:**
- Produces:
  - `ClipboardCaptureGate.SHARE_LINK_LABELS: List<String>` = `["分享链接","复制链接","口令"]`
  - `matchShareLinkLabel(text: String?, contentDesc: String?): Boolean` — text 或 desc 以任一别名开头
  - `isSharePanel(nodeTexts: List<String>): Boolean` — 含「取消」或「发送给朋友」，或 ≥2 个别名命中
  - `isFresh(clipTimestampMs: Long, clickTimestampMs: Long): Boolean` — clip 严格晚于 click
  - `isDuplicate(url: String, seen: Set<String>): Boolean`
  - `acceptDelivery(deliveryToken: Long, expectedToken: Long): Boolean` — 相等，或 deliveryToken==LEGACY_ACTION_SEND_TOKEN(-1L) 豁免
  - `const val LEGACY_ACTION_SEND_TOKEN = -1L`

- [ ] **Step 1: 写 failing 测试**

创建 ClipboardCaptureGateTest.kt：
```kotlin
package com.zenithjoy.agent.collect

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipboardCaptureGateTest {

    // TC-G01: 别名前缀匹配（text 通道）
    @Test fun `matches share link label via text`() {
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel("分享链接", null))
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel("复制链接给好友", null))
    }

    // TC-G02: 别名前缀匹配（contentDesc 通道）
    @Test fun `matches share link label via content desc`() {
        assertTrue(ClipboardCaptureGate.matchShareLinkLabel(null, "口令"))
    }

    // TC-G03: 不命中别名
    @Test fun `does not match unrelated label`() {
        assertFalse(ClipboardCaptureGate.matchShareLinkLabel("保存本地", "举报"))
        assertFalse(ClipboardCaptureGate.matchShareLinkLabel(null, null))
    }

    // TC-G04: 面板锚点——含取消即判面板
    @Test fun `is share panel when cancel anchor present`() {
        assertTrue(ClipboardCaptureGate.isSharePanel(listOf("转发到日常", "取消")))
    }

    // TC-G05: 面板锚点——≥2 别名命中
    @Test fun `is share panel when two labels hit`() {
        assertTrue(ClipboardCaptureGate.isSharePanel(listOf("复制链接", "分享链接", "举报")))
    }

    // TC-G06: 详情页节点集不判为面板
    @Test fun `detail page nodes are not share panel`() {
        assertFalse(ClipboardCaptureGate.isSharePanel(listOf("关注", "评论", "点赞", "分享")))
    }

    // TC-G07: 新鲜度——clip 早于点击则拒
    @Test fun `stale clip rejected`() {
        assertFalse(ClipboardCaptureGate.isFresh(clipTimestampMs = 1000L, clickTimestampMs = 2000L))
        assertTrue(ClipboardCaptureGate.isFresh(clipTimestampMs = 3000L, clickTimestampMs = 2000L))
    }

    // TC-G08: 去重
    @Test fun `duplicate url rejected`() {
        val seen = setOf("https://v.douyin.com/AbC123/")
        assertTrue(ClipboardCaptureGate.isDuplicate("https://v.douyin.com/AbC123/", seen))
        assertFalse(ClipboardCaptureGate.isDuplicate("https://v.douyin.com/xYz789/", seen))
    }

    // TC-G09: token 校验——不符拒，相符收，legacy 豁免
    @Test fun `delivery token validated with legacy exemption`() {
        assertTrue(ClipboardCaptureGate.acceptDelivery(deliveryToken = 5L, expectedToken = 5L))
        assertFalse(ClipboardCaptureGate.acceptDelivery(deliveryToken = 4L, expectedToken = 5L))
        assertTrue(ClipboardCaptureGate.acceptDelivery(
            deliveryToken = ClipboardCaptureGate.LEGACY_ACTION_SEND_TOKEN, expectedToken = 5L))
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*ClipboardCaptureGateTest"`
Expected: FAIL（ClipboardCaptureGate 不存在，编译失败）

- [ ] **Step 3: 写实现**

创建 ClipboardCaptureGate.kt：
```kotlin
package com.zenithjoy.agent.collect

/**
 * Bug C 剪贴板取链路线的纯判定逻辑（不碰 Android API，JVM 可单测）。
 * 剪贴板残留会静默产生"合法但错误"的 share_url（=系统性造假 id），故新鲜度用
 * 时间戳 + 去重双闸；面板/按钮判定用内容锚点，避免把详情页误当分享面板。
 */
object ClipboardCaptureGate {

    const val LEGACY_ACTION_SEND_TOKEN = -1L

    val SHARE_LINK_LABELS = listOf("分享链接", "复制链接", "口令")
    private val PANEL_ANCHORS = listOf("取消", "发送给朋友")

    fun matchShareLinkLabel(text: String?, contentDesc: String?): Boolean {
        val hit = { s: String? -> s != null && SHARE_LINK_LABELS.any { s.startsWith(it) } }
        return hit(text) || hit(contentDesc)
    }

    fun isSharePanel(nodeTexts: List<String>): Boolean {
        if (nodeTexts.any { t -> PANEL_ANCHORS.any { t.startsWith(it) } }) return true
        val labelHits = nodeTexts.count { t -> SHARE_LINK_LABELS.any { t.startsWith(it) } }
        return labelHits >= 2
    }

    fun isFresh(clipTimestampMs: Long, clickTimestampMs: Long): Boolean =
        clipTimestampMs > clickTimestampMs

    fun isDuplicate(url: String, seen: Set<String>): Boolean = url in seen

    fun acceptDelivery(deliveryToken: Long, expectedToken: Long): Boolean =
        deliveryToken == expectedToken || deliveryToken == LEGACY_ACTION_SEND_TOKEN
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*ClipboardCaptureGateTest"`
Expected: PASS（TC-G01~G09）

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ClipboardCaptureGate.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/ClipboardCaptureGateTest.kt
git commit -m "feat(collect): ClipboardCaptureGate 剪贴板取链纯函数判定 + 单测"
```

---

### Task 3: ShareIngestActivity 剪贴板模式 + manifest

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ShareIngestActivity.kt`
- Modify: `services/agent-android/app/src/main/AndroidManifest.xml:44-50`

**Interfaces:**
- Consumes: `DouyinCollectService.deliverShareText`（Task 4 升级为带 token）、`DouyinCollectService.deliverClearDone`、`DouyinCollectService.noteIngestLaunched(token)`
- Produces:
  - `ShareIngestActivity.EXTRA_INGEST_MODE = "ingest_mode"`、`MODE_READ_CLIPBOARD="read_clipboard"`、`MODE_CLEAR_CLIPBOARD="clear_clipboard"`
  - `ShareIngestActivity.EXTRA_INGEST_TOKEN = "ingest_token"`
  - `fun launchReadIntent(ctx, token): Intent`、`fun launchClearIntent(ctx): Intent` 静态构造器

**说明**：本 Activity 依赖真实 Android 焦点/剪贴板，CI 无法单测；守卫为真机 E2E（Task 5 验收）。此任务无 JVM 单测，逻辑判定已在 Task 2 覆盖。

- [ ] **Step 1: 改 manifest 加 singleTask**

AndroidManifest.xml 的 ShareIngestActivity 节点，在 `android:name` 之后加：
```xml
            android:launchMode="singleTask"
```
（保留现有 exported/excludeFromRecents/noHistory/taskAffinity/theme）

- [ ] **Step 2: 重写 ShareIngestActivity 按 mode 分流**

整体替换文件内容：
```kotlin
package com.zenithjoy.agent.collect

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * Bug C：取链接收器，两条路径共用。
 * - ACTION_SEND（旧兼容）：onCreate 即收即 finish，token 用 LEGACY 豁免。
 * - read_clipboard：抖音"分享链接"把口令文案写进剪贴板。Android 10+ 只有前台焦点窗口能读，
 *   故本 Activity 拉到前台，在 onWindowFocusChanged(true) 后读，读不到 100ms 轮询 ≤10 次，
 *   3s 自杀超时（严格短于服务侧等待预算）。
 * - clear_clipboard：获焦后清空剪贴板做基线，回投 CLEAR_DONE。
 */
class ShareIngestActivity : Activity() {

    private var mode: String = MODE_READ_CLIPBOARD
    private var token: Long = DouyinCollectService.LEGACY_ACTION_SEND_TOKEN
    private var handled = false
    private var pollCount = 0
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        route(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handled = false
        pollCount = 0
        route(intent)
    }

    private fun route(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            android.util.Log.i(TAG, "ACTION_SEND len=${text?.length ?: 0}")
            DouyinCollectService.deliverShareText(text, DouyinCollectService.LEGACY_ACTION_SEND_TOKEN)
            finish()
            return
        }
        mode = intent?.getStringExtra(EXTRA_INGEST_MODE) ?: MODE_READ_CLIPBOARD
        token = intent?.getLongExtra(EXTRA_INGEST_TOKEN, DouyinCollectService.LEGACY_ACTION_SEND_TOKEN)
            ?: DouyinCollectService.LEGACY_ACTION_SEND_TOKEN
        DouyinCollectService.noteIngestLaunched(token)
        // 3s 自杀超时兜底（焦点始终不来时不泄漏）
        handler.postDelayed({ if (!handled) finishRead(null) }, SELF_KILL_MS)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || handled) return
        when (mode) {
            MODE_CLEAR_CLIPBOARD -> {
                clearClipboard()
                handled = true
                DouyinCollectService.deliverClearDone(token)
                finish()
            }
            else -> tryReadClipboard()
        }
    }

    private fun tryReadClipboard() {
        val text = readClipboardText()
        if (text != null) {
            finishRead(text)
            return
        }
        if (pollCount++ < MAX_POLL) {
            handler.postDelayed({ if (!handled) tryReadClipboard() }, POLL_INTERVAL_MS)
        }
        // 达上限后交给 SELF_KILL_MS 兜底 finishRead(null)
    }

    private fun finishRead(text: String?) {
        if (handled) return
        handled = true
        handler.removeCallbacksAndMessages(null)
        DouyinCollectService.deliverShareText(text, token)
        finish()
    }

    private fun readClipboardText(): String? {
        return try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = cm.primaryClip ?: return null
            if (clip.itemCount == 0) return null
            clip.getItemAt(0).coerceToText(this)?.toString()?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "readClipboard failed: ${e.message}")
            null
        }
    }

    private fun clearClipboard() {
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("", ""))
        } catch (e: Exception) {
            android.util.Log.w(TAG, "clearClipboard failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ShareIngestActivity"
        private const val SELF_KILL_MS = 3_000L
        private const val POLL_INTERVAL_MS = 100L
        private const val MAX_POLL = 10
        const val EXTRA_INGEST_MODE = "ingest_mode"
        const val EXTRA_INGEST_TOKEN = "ingest_token"
        const val MODE_READ_CLIPBOARD = "read_clipboard"
        const val MODE_CLEAR_CLIPBOARD = "clear_clipboard"

        fun launchReadIntent(ctx: Context, token: Long): Intent =
            Intent(ctx, ShareIngestActivity::class.java).apply {
                putExtra(EXTRA_INGEST_MODE, MODE_READ_CLIPBOARD)
                putExtra(EXTRA_INGEST_TOKEN, token)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

        fun launchClearIntent(ctx: Context, token: Long): Intent =
            Intent(ctx, ShareIngestActivity::class.java).apply {
                putExtra(EXTRA_INGEST_MODE, MODE_CLEAR_CLIPBOARD)
                putExtra(EXTRA_INGEST_TOKEN, token)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
    }
}
```

- [ ] **Step 3: 编译确认（依赖 Task 4 的静态方法，故本步允许编译红，Task 4 后统一绿）**

本任务与 Task 4 相互依赖（deliverShareText 新签名 / deliverClearDone / noteIngestLaunched 在 Task 4 建）。**执行顺序：先做 Task 4 再回本步**，或本步与 Task 4 合并为一次编译验证。
Run（Task 4 完成后）: `cd services/agent-android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit（与 Task 4 一起，见 Task 4 Step 末）**

> 注：Task 3 与 Task 4 是同一编译单元的两半，合并提交。

---

### Task 4: deliverShareText token 通道升级 + companion 静态入口

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（companion deliverShareText 约 892 行、pendingShareCapture 63 行）

**Interfaces:**
- Consumes: `ClipboardCaptureGate.acceptDelivery`、`ClipboardCaptureGate.LEGACY_ACTION_SEND_TOKEN`
- Produces:
  - `DouyinCollectService.LEGACY_ACTION_SEND_TOKEN: Long`（转发 Gate 常量，供 Activity 引用）
  - `fun deliverShareText(rawText: String?, deliveryToken: Long)`
  - `fun deliverClearDone(deliveryToken: Long)`
  - `fun noteIngestLaunched(token: Long)`（置回执标志）
  - `fun consumeIngestLaunched(token: Long): Boolean`（服务侧查回执，查后清）
  - 实例字段 `pendingShareCapture: Pair<Long, CompletableDeferred<String?>>?`、`pendingClearDone: Pair<Long, CompletableDeferred<Boolean>>?`

- [ ] **Step 1: 改 pendingShareCapture 为带 token 的 Pair + 新增 pendingClearDone**

DouyinCollectService.kt 第 63 行附近替换：
```kotlin
    // Bug C 剪贴板路线：等待 ShareIngestActivity 读回的短链，带 token 防跨卡串号。
    @Volatile private var pendingShareCapture: Pair<Long, CompletableDeferred<String?>>? = null
    @Volatile private var pendingClearDone: Pair<Long, CompletableDeferred<Boolean>>? = null
    // 拉起回执：Activity onCreate 时置为其 token，服务侧 consume 判定拉起成功
    @Volatile private var ingestLaunchedToken: Long = Long.MIN_VALUE
```

- [ ] **Step 2: 重写 companion deliverShareText + 新增 deliverClearDone/noteIngestLaunched/consumeIngestLaunched**

替换 892-906 行的 deliverShareText，并在其后追加：
```kotlin
        /** ShareIngestActivity 读回剪贴板文案后投递；token 校验通过才 complete，防跨卡串号。 */
        fun deliverShareText(rawText: String?, deliveryToken: Long) {
            val link = ShareLinkExtractor.extract(rawText)
            val inst = activeInstance ?: run {
                android.util.Log.w(TAG, "deliverShareText: no active instance, drop"); return
            }
            val pending = inst.pendingShareCapture ?: run {
                android.util.Log.w(TAG, "deliverShareText: no pending capture, drop link=$link"); return
            }
            if (!ClipboardCaptureGate.acceptDelivery(deliveryToken, pending.first)) {
                android.util.Log.w(TAG, "deliverShareText: token mismatch d=$deliveryToken e=${pending.first}, drop"); return
            }
            android.util.Log.i(TAG, "deliverShareText: delivering link=$link token=$deliveryToken")
            pending.second.complete(link)
        }

        /** clear_clipboard 模式完成回投。 */
        fun deliverClearDone(deliveryToken: Long) {
            val inst = activeInstance ?: return
            val pending = inst.pendingClearDone ?: return
            if (!ClipboardCaptureGate.acceptDelivery(deliveryToken, pending.first)) return
            pending.second.complete(true)
        }

        /** Activity onCreate 时记回执。 */
        fun noteIngestLaunched(token: Long) {
            activeInstance?.ingestLaunchedToken = token
        }
```

- [ ] **Step 3: 新增实例方法 consumeIngestLaunched（放在 captureShareUrlForCard 附近的实例方法区）**

```kotlin
    /** 服务侧查 startActivity 后 Activity 是否已 onCreate（回执 token 匹配），查后清。 */
    private fun consumeIngestLaunched(token: Long): Boolean {
        val ok = ingestLaunchedToken == token
        if (ok) ingestLaunchedToken = Long.MIN_VALUE
        return ok
    }
```

- [ ] **Step 4: 暴露 LEGACY_ACTION_SEND_TOKEN 常量（companion 内）**

在 companion 常量区加：
```kotlin
        const val LEGACY_ACTION_SEND_TOKEN = ClipboardCaptureGate.LEGACY_ACTION_SEND_TOKEN
```

- [ ] **Step 5: 编译（Task 3 + Task 4 合并验证）**

Run: `cd services/agent-android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL（captureShareUrlForCard 里旧的 `pendingShareCapture = null` / `pendingShareCapture = deferred` 赋值此时会编译红 → 由 Task 5 重写；若单独验证本步，先把这两处临时改为 Pair 形态或直接进 Task 5）

> **实操建议**：Task 3/4/5 是同一编译单元，按 4→3→5 顺序改完再统一编译。以下 commit 合并三者。

- [ ] **Step 6: 跑全部 agent 单测确认无回归**

Run: `cd services/agent-android && ./gradlew :app:testDebugUnitTest`
Expected: PASS（含 Task 1/2 新测）

- [ ] **Step 7: Commit（含 Task 3 + Task 4）**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/ShareIngestActivity.kt services/agent-android/app/src/main/AndroidManifest.xml services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "feat(collect): ShareIngestActivity 剪贴板读取模式 + token 回投通道"
```

---

### Task 5: captureShareUrlForCard 重写为剪贴板路线 + 版本 bump

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（captureShareUrlForCard 459-490、collectVideoCards 433-455、常量区 883-884、删 findShareTargetForThisApp 494-508）
- Modify: `services/agent-android/app/build.gradle.kts:14-15`

**Interfaces:**
- Consumes: `ClipboardCaptureGate.*`、`ShareIngestActivity.launchReadIntent/launchClearIntent`、`consumeIngestLaunched`、`ShareLinkExtractor.extract`
- 复用现有 helper：`awaitRootInActiveWindow(attempts)`、`tapNodeCenter(node)`、`findVideoCards(root,max)`、`findNodeByContentDescPrefix(root,prefix)`、`findNodeByText`、`findNodeByContentDesc`、`findScrollableNode`、`navigateBackToResults`、`RandomDelay.sample`

**说明**：无障碍全链 CI 无法仿真，此任务判定逻辑已由 Task 2 单测覆盖；行为守卫为真机 E2E（下方验收）。

- [ ] **Step 1: 加常量、token 自增器、seenShareUrls 集合**

companion 常量区（883 行附近）替换/追加：
```kotlin
        private const val PER_CARD_TIMEOUT_MS = 25_000L
        private const val CLEAR_WAIT_MS = 2_000L
        private const val READ_DELIVER_MS = 4_000L
        private const val LAUNCH_ECHO_TIMEOUT_MS = 1_000L
        private const val LAUNCH_ECHO_POLL_MS = 100L
        private const val PANEL_SETTLE_MS = 300L
        private const val PANEL_MAX_ATTEMPTS = 7
```
实例字段区（63 行附近）追加：
```kotlin
    private var shareTokenSeq = 0L
    private val seenShareUrls = mutableSetOf<String>()
```

- [ ] **Step 2: 重写 collectVideoCards（连续失败提前中断 + seen 清理）**

替换 433-455 行：
```kotlin
    private suspend fun collectVideoCards(videoCards: List<AccessibilityNodeInfo>) {
        if (resultReported) return
        seenShareUrls.clear()
        val targetCount = minOf(videoCards.size, MAX_VIDEOS_PER_SEARCH)
        val collected = mutableListOf<VideoCardInfo>()
        var consecutiveFailures = 0
        for (index in 0 until targetCount) {
            val shareUrl = captureShareUrlForCard(index)
            pendingShareCapture = null
            pendingClearDone = null
            if (shareUrl != null) {
                collected.add(VideoCardInfo(videoId = "", keyword = currentKeyword, shareUrl = shareUrl))
                seenShareUrls.add(shareUrl)
                consecutiveFailures = 0
                android.util.Log.i(TAG, "Stage1 card#$index share_url captured: $shareUrl")
            } else {
                consecutiveFailures++
                android.util.Log.w(TAG, "Stage1 card#$index share_url capture failed — skip ($consecutiveFailures)")
                if (consecutiveFailures >= 2) {
                    android.util.Log.w(TAG, "Stage1 aborting: 2 consecutive failures")
                    break
                }
            }
            navigateBackToResults()
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
        }
        android.util.Log.i(TAG, "Stage1 collected ${collected.size}/$targetCount for keyword=$currentKeyword")
        if (collected.isEmpty()) {
            reportVideoCards(emptyList(), error = "ALL_SHARE_FAILED")
        } else {
            reportVideoCards(collected, error = "")
        }
    }
```

- [ ] **Step 3: 重写 captureShareUrlForCard（剪贴板全流程）**

替换 459-490 行：
```kotlin
    private suspend fun captureShareUrlForCard(index: Int): String? {
        return withTimeoutOrNull(PER_CARD_TIMEOUT_MS) {
            // 1. 重抓卡并点开详情
            val listRoot = rootInActiveWindow ?: return@withTimeoutOrNull null
            val card = findVideoCards(listRoot, MAX_VIDEOS_PER_SEARCH).getOrNull(index)
                ?: return@withTimeoutOrNull null
            tapNodeCenter(card)
            delay(RandomDelay.sample(RandomDelay.NAV_MS))
            val detailRoot = awaitRootInActiveWindow(attempts = 6) ?: return@withTimeoutOrNull null

            // 2. 点分享
            val shareBtn = findNodeByContentDescPrefix(detailRoot, "分享")
                ?: findNodeByContentDescPrefix(detailRoot, "转发")
                ?: return@withTimeoutOrNull null
            tapNodeCenter(shareBtn)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))

            // 3. 等分享面板出现（内容锚点，不用裸 root）
            val sheetRoot = awaitSharePanel() ?: return@withTimeoutOrNull null

            // 4. 清剪贴板基线（透明 Activity clear 模式）
            if (!clearClipboardBaseline()) return@withTimeoutOrNull null

            // 5. 面板里找"分享链接"（别名表 + 面板子树 + 滚动 ≤3）
            val linkBtn = findShareLinkButton(sheetRoot) ?: return@withTimeoutOrNull null

            // 6. 点"分享链接" → 拉起透明 Activity 读剪贴板
            val token = ++shareTokenSeq
            val deferred = CompletableDeferred<String?>()
            pendingShareCapture = token to deferred
            val clickAtMs = android.os.SystemClock.elapsedRealtime()
            tapNodeCenter(linkBtn)
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            startActivity(ShareIngestActivity.launchReadIntent(this@DouyinCollectService, token))

            // 7. 拉起回执（区分环境阻断）
            if (!awaitLaunchEcho(token)) {
                android.util.Log.w(TAG, "ACTIVITY_LAUNCH_BLOCKED token=$token")
                return@withTimeoutOrNull null
            }

            // 8. 等读回短链
            val link = withTimeoutOrNull(READ_DELIVER_MS) { deferred.await() } ?: return@withTimeoutOrNull null

            // 9. 三层新鲜度：去重（时间戳新鲜度已由 clear 基线保证；此处 clickAtMs 供日志/未来扩展）
            if (ClipboardCaptureGate.isDuplicate(link, seenShareUrls)) {
                android.util.Log.w(TAG, "duplicate share_url (stale clip?) link=$link — skip")
                return@withTimeoutOrNull null
            }
            android.util.Log.i(TAG, "card#$index fresh link=$link (clickAt=$clickAtMs)")
            link
        }
    }

    // 分享面板出现判定：内容锚点（含取消/发送给朋友或 ≥2 别名命中）
    private suspend fun awaitSharePanel(): AccessibilityNodeInfo? {
        repeat(PANEL_MAX_ATTEMPTS) {
            val root = rootInActiveWindow
            if (root != null && ClipboardCaptureGate.isSharePanel(collectNodeTexts(root))) return root
            delay(PANEL_SETTLE_MS)
        }
        return null
    }

    // 清剪贴板基线：拉起 clear 模式 Activity，等 CLEAR_DONE
    private suspend fun clearClipboardBaseline(): Boolean {
        val token = ++shareTokenSeq
        val done = CompletableDeferred<Boolean>()
        pendingClearDone = token to done
        startActivity(ShareIngestActivity.launchClearIntent(this@DouyinCollectService, token))
        if (!awaitLaunchEcho(token)) return false
        val ok = withTimeoutOrNull(CLEAR_WAIT_MS) { done.await() } ?: false
        // clear Activity finish 后回到分享面板需要一瞬
        delay(RandomDelay.sample(RandomDelay.CLICK_MS))
        return ok
    }

    private suspend fun awaitLaunchEcho(token: Long): Boolean {
        val deadline = android.os.SystemClock.elapsedRealtime() + LAUNCH_ECHO_TIMEOUT_MS
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if (consumeIngestLaunched(token)) return true
            delay(LAUNCH_ECHO_POLL_MS)
        }
        return false
    }

    // 面板子树里找"分享链接"，找不到滚功能排 ≤3 次
    private suspend fun findShareLinkButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        matchLinkNode(root)?.let { return it }
        val scrollable = findScrollableNode(root) ?: return null
        repeat(3) {
            if (!scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return null
            delay(RandomDelay.sample(RandomDelay.CLICK_MS))
            val fresh = rootInActiveWindow ?: return null
            matchLinkNode(fresh)?.let { return it }
        }
        return null
    }

    private fun matchLinkNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (ClipboardCaptureGate.matchShareLinkLabel(
                    node.text?.toString(), node.contentDescription?.toString())) {
                return node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return null
    }

    private fun collectNodeTexts(root: AccessibilityNodeInfo): List<String> {
        val out = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var n = 0
        while (queue.isNotEmpty() && n++ < MAX_FLATTEN_NODES) {
            val node = queue.removeFirst()
            node.text?.toString()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            node.contentDescription?.toString()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return out
    }
```

- [ ] **Step 4: 删除废弃的 findShareTargetForThisApp / thisAppLabel（share-intent 专用，剪贴板路线不再用）**

删除 494-517 行的 `findShareTargetForThisApp` 与 `thisAppLabel` 两个函数（`findScrollableNode` 保留，Task 5 复用）。

- [ ] **Step 5: 版本 bump**

build.gradle.kts 第 14-15 行：
```kotlin
        versionCode = 5
        versionName = "2.1.1"
```

- [ ] **Step 6: 编译 + 全量单测**

Run: `cd services/agent-android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest`
Expected: BUILD SUCCESSFUL；所有测试 PASS

- [ ] **Step 7: lint**

Run: `cd services/agent-android && ./gradlew :app:lintDebug` （若项目配置了 ktlint/detekt 则一并跑）
Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt services/agent-android/app/build.gradle.kts
git commit -m "feat(collect): captureShareUrlForCard 重写为剪贴板取链 + bump 2.1.1"
```

---

## 真机 E2E 验收（repo 外，用户在场，proven-to-fire 守卫）

1. CI「Android CI — agent-android」出 artifact → scp xian-rog C:/temp → adb install -r → 恢复无障碍三组件 → monkey 启动
2. 真机关闭荣耀「剪贴板使用提醒」开关（设置→隐私→其他隐私设置）
3. 点火 Stage1：`curl -X POST http://38.23.47.81:5201/api/acquisition/collect/start -H "X-Tenant-Id: 455a8ca9-5f63-4286-83ce-c5cca04cfd58" -H "Content-Type: application/json" -d '{"keywords":["装修报价"],"agent_id":"a7a7b36c-6d05-4653-8ba1-83c1553ef5c7"}'`
4. 验收：DB 登记 ≥1 条真实 ≥10 位数字 video_id（非 card_N/hash）；Stage2 深链打开采到评论
5. proven-to-fire：环境阻断时 ACTIVITY_LAUNCH_BLOCKED 出现在日志、任务 ALL_SHARE_FAILED 而非造假 id（已在任务 0b1a35a2 见过 ALL_SHARE_FAILED 报红）

## 自查覆盖

- spec「架构改动」5 节 → Task 1（正则）/Task 2（Gate）/Task 3（Activity）/Task 4（通道）/Task 5（服务重写+bump），全覆盖
- spec「实现注意点」6 条：①Activity mode 分流=Task3 ②正则收敛+服务端同步=Task1 ③EXTRA 独立常量=Task3 ④launchEcho 轮询=Task5 awaitLaunchEcho ⑤token 豁免=Task2 TC-G09+Task4 ⑥Gate 禁 Log=Task2
- 类型一致性：deliverShareText(rawText, deliveryToken) 两参签名在 Task3 调用与 Task4 定义一致；token Long 贯穿；LEGACY_ACTION_SEND_TOKEN 单一来源 ClipboardCaptureGate
