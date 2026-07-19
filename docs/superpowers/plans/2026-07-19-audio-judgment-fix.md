# 音频转写判定三缺口修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Path2 安卓 Seg2 音频转写判定的三处真实缺口——RECORD_AUDIO 权限缺失、WAV 格式封装缺失、title 信号全链路未打通——让真机 `/judge-video` 不再静默卡死在 pending。

**Architecture:** 见 `docs/superpowers/specs/2026-07-19-audio-judgment-fix-design.md`。核心数据流：Stage1 采集时从卡片节点文本里取 best-effort title → 落库（已有列，无需 migration）→ Stage2 判定轮询时服务端把 title 随 `pending-collect-tasks` 响应带回 Android → Android 把 title 透传进 `/judge-video` 请求体 → 服务端 `buildPrompt()` 用 title+音频做"先转写再判定"的单次多模态调用。

**Tech Stack:** Kotlin (Android agent, JVM 单测 JUnit4，无 Robolectric)、TypeScript (apps/api，vitest)、PostgreSQL。

---

### Task 1: RECORD_AUDIO 权限声明 + 运行时申请

**Files:**
- Modify: `services/agent-android/app/src/main/AndroidManifest.xml`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/ManifestRecordAudioPermissionTest.kt`

**背景**：真机复现——`AudioRecord.Builder().build()` 在没有 `RECORD_AUDIO` 权限时抛 `SecurityException`，被 `AudioRecordService.captureAudioSnippet()` 的 catch 块吞掉记日志后返回 null，链路静默卡死。项目里没有任何既有运行时权限检查代码（已勘查确认零处 `ContextCompat.checkSelfPermission` 用法），需仿照现有 `MediaProjectionHolder`/`mediaProjectionLauncher` 一次性授权模式新增。`androidx.core:core-ktx` 依赖已在 `build.gradle.kts` 里，`ContextCompat`/`ActivityCompat` 可直接 import，无需加依赖。

- [ ] **Step 1: 写失败的 manifest 守卫测试**

参照已有 `ManifestForegroundServiceTypeTest.kt` 风格（直接读 manifest 文件文本断言 contains），新建：

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * RECORD_AUDIO 权限声明守卫（回归）。
 *
 * 真机复现 2026-07-19：AudioRecordService.captureAudioSnippet() 里
 * AudioRecord.Builder().build() 在没有 RECORD_AUDIO 权限时抛 SecurityException，
 * 被 catch 吞掉返回 null，音频转写判定链路静默卡死——manifest 从未声明过这个权限。
 */
class ManifestRecordAudioPermissionTest {

    private fun readManifest(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found at ${candidates.map { it.path }}")
        return file.readText()
    }

    @Test
    fun `manifest必须声明RECORD_AUDIO权限`() {
        val manifest = readManifest()
        assertTrue(
            "AndroidManifest.xml 缺少 RECORD_AUDIO 权限声明，音频转写判定在真机会静默卡死",
            manifest.contains("android.permission.RECORD_AUDIO"),
        )
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.ManifestRecordAudioPermissionTest"`
Expected: FAIL（`manifest必须声明RECORD_AUDIO权限` 断言失败，因为 manifest 里还没有这行）

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/ManifestRecordAudioPermissionTest.kt
git commit -m "test: RECORD_AUDIO权限声明守卫（RED，真机静默卡死回归）"
```

- [ ] **Step 4: Manifest 加权限声明**

在 `services/agent-android/app/src/main/AndroidManifest.xml` 第 9 行（`WAKE_LOCK` 后）加一行：

```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.ManifestRecordAudioPermissionTest"`
Expected: PASS

- [ ] **Step 6: MainActivity 加运行时申请流程**

在 `MainActivity.kt` 里，仿照 `mediaProjectionLauncher`/`requestMediaProjectionThenStart()` 的既有模式新增录音权限申请。完整改动（基于当前文件内容）：

在文件顶部 import 区（第 1-16 行）新增：

```kotlin
package com.zenithjoy.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.zenithjoy.agent.onboarding.collectServiceEnabled
import com.zenithjoy.agent.onboarding.parseBindDeepLink
```

在 `mediaProjectionLauncher` 定义（第 36-49 行）之后新增一个 permission launcher：

```kotlin
    private val recordAudioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            android.util.Log.i(TAG, "RECORD_AUDIO authorized")
        } else {
            android.util.Log.w(TAG, "RECORD_AUDIO denied — audio-based content judgment stays pending")
            Toast.makeText(this, "录音授权被拒绝，音频转写判定功能将持续 pending", Toast.LENGTH_LONG).show()
        }
        showStatus()
    }
```

在 `mediaProjectionBanner()`（第 91-104 行）之后新增一个平行的 banner 函数：

```kotlin
    /** 状态自检：RECORD_AUDIO 权限是否就绪，方便真机巡检定位"音频判定恒 pending"问题。 */
    private fun recordAudioBanner(): android.view.View {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) {
            TextView(this).apply { text = "录音授权 ✅ 已授权（音频判定可用）" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ 录音未授权，视频类内容判定将持续 pending" })
            box.addView(Button(this).apply {
                text = "授权录音"
                setOnClickListener { recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }
            })
            box
        }
    }
```

在 `showStatus()`（第 145-188 行）里，`layout.addView(mediaProjectionBanner())`（第 178 行）之后新增一行：

```kotlin
        layout.addView(accessibilityBanner())
        layout.addView(mediaProjectionBanner())
        layout.addView(recordAudioBanner())
        layout.addView(status)
```

- [ ] **Step 7: commit（commit-2 GREEN）**

```bash
git add services/agent-android/app/src/main/AndroidManifest.xml services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt
git commit -m "fix(agent-android): 声明RECORD_AUDIO权限+MainActivity运行时申请流程，解除音频判定真机静默卡死"
```

---

### Task 2: WAV header 封装（修正格式声明与实际编码不符）

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/WavHeader.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AudioRecordService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/WavHeaderTest.kt`

**背景**：`AudioRecordService.captureAudioSnippet()` 把裸 PCM 字节直接 base64 编码返回，服务端 `content-judgment.ts:138` 却把它按 `format: 'wav'` 发给 Gemini（OpenAI 兼容 `input_audio.format` 只认字面值，裸 PCM 配 wav 声明会让 Gemini 解析失败/乱猜）。抽成独立纯 Kotlin 函数（无 Android 依赖），对齐既有 `CardClassifier`/`ClipboardCaptureGate` 的纯函数可测试设计。

- [ ] **Step 1: 写失败的 WAV header 单测**

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * WavHeader 纯函数测试——验证给裸 PCM 字节流前置的 44 字节 WAV/RIFF header 合法。
 *
 * 真机根因 2026-07-19：AudioRecordService 之前直接把裸 PCM 字节 base64 编码返回，
 * 服务端却把它按 format: 'wav' 发给 Gemini（OpenAI 兼容 input_audio.format 只认
 * 字面值），裸 PCM 配 wav 声明会让 Gemini 解析失败/产出垃圾判断。
 */
class WavHeaderTest {

    @Test
    fun `wrapPcmAsWav生成的字节流以RIFF开头以WAVE标记`() {
        val pcm = ByteArray(100) { it.toByte() }
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        assertEquals(44 + pcm.size, wav.size)
        assertEquals("RIFF", String(wav.copyOfRange(0, 4), Charsets.US_ASCII))
        assertEquals("WAVE", String(wav.copyOfRange(8, 12), Charsets.US_ASCII))
        assertEquals("fmt ", String(wav.copyOfRange(12, 16), Charsets.US_ASCII))
        assertEquals("data", String(wav.copyOfRange(36, 40), Charsets.US_ASCII))
    }

    @Test
    fun `wrapPcmAsWav的采样率和位深字段与传入参数一致`() {
        val pcm = ByteArray(50)
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        val sampleRate = ByteBuffer.wrap(wav, 24, 4).order(ByteOrder.LITTLE_ENDIAN).int
        val channels = ByteBuffer.wrap(wav, 22, 2).order(ByteOrder.LITTLE_ENDIAN).short
        val bitsPerSample = ByteBuffer.wrap(wav, 34, 2).order(ByteOrder.LITTLE_ENDIAN).short

        assertEquals(16_000, sampleRate)
        assertEquals(1, channels.toInt())
        assertEquals(16, bitsPerSample.toInt())
    }

    @Test
    fun `wrapPcmAsWav的data块长度字段等于PCM数据实际长度`() {
        val pcm = ByteArray(777)
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        val dataSize = ByteBuffer.wrap(wav, 40, 4).order(ByteOrder.LITTLE_ENDIAN).int
        assertEquals(777, dataSize)
        // header 之后的字节必须是原样 PCM 数据（顺序不变）
        assertEquals(pcm.toList(), wav.copyOfRange(44, wav.size).toList())
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.WavHeaderTest"`
Expected: FAIL（编译错误：`WavHeader` 不存在）

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/WavHeaderTest.kt
git commit -m "test: WAV header封装纯函数守卫（RED，格式声明与实际编码不符回归）"
```

- [ ] **Step 4: 实现 WavHeader.kt**

```kotlin
package com.zenithjoy.agent

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * WavHeader — 纯 Kotlin WAV/RIFF header 封装（无 Android 依赖，对齐 CardClassifier 的
 * 纯函数可测试设计）。
 *
 * 用途：AudioRecordService 录制得到的是裸 PCM 字节流，服务端 content-judgment.ts 按
 * `format: 'wav'` 声明发给 Gemini（OpenAI 兼容 input_audio.format 只认字面值）——
 * 这里把 44 字节标准 WAV header 前置到 PCM 数据前，使字节流真的是合法 WAV 文件。
 */
object WavHeader {
    private const val HEADER_SIZE = 44
    private const val PCM_FMT_CHUNK_SIZE = 16
    private const val AUDIO_FORMAT_PCM: Short = 1

    fun wrapPcmAsWav(pcm: ByteArray, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        val dataSize = pcm.size

        val header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + dataSize)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(PCM_FMT_CHUNK_SIZE)
        header.putShort(AUDIO_FORMAT_PCM)
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign.toShort())
        header.putShort(bitsPerSample.toShort())
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataSize)

        return header.array() + pcm
    }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.WavHeaderTest"`
Expected: PASS（3/3）

- [ ] **Step 6: 接入 AudioRecordService.captureAudioSnippet()**

在 `AudioRecordService.kt` 里，把第 84 行：

```kotlin
            Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
```

改为：

```kotlin
            val wavBytes = WavHeader.wrapPcmAsWav(
                pcm = outputStream.toByteArray(),
                sampleRate = SAMPLE_RATE,
                channels = 1,
                bitsPerSample = 16,
            )
            Base64.encodeToString(wavBytes, Base64.NO_WRAP)
```

- [ ] **Step 7: commit（commit-2 GREEN）**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/WavHeader.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AudioRecordService.kt
git commit -m "fix(agent-android): AudioRecordService返回合法WAV字节流，匹配服务端format:wav声明"
```

---

### Task 3: DouyinCollectService title 采集

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/CardTitleExtractor.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/CardTitleExtractorTest.kt`

**背景**：`VideoCardInfo.title` 字段存在但从未被赋值（`collectVideoCards` 第 592 行构造时只传 `videoId=""`/`keyword`/`shareUrl`）。`classifyCardAtIndex()` 已经在分类时用 `collectNodeTexts(card)` 读过卡片文本节点，证明标题信号在这一步可读——用真机 dump 样本（`DouyinCardClassifyTest.videoTexts`）验证过：真实卡片标题文本就是子树里最长的一条。选题逻辑抽成纯函数 `CardTitleExtractor.pickTitle(texts)`（对齐 `CardClassifier` 的纯 Kotlin 可测试设计），因为 `AccessibilityNodeInfo`/`rootInActiveWindow` 无法在无 Robolectric 的纯 JVM 测试里构造，只测可测的纯函数部分；真机接缝已在 PrepPRD 里标注为下次真机 session 验证。

- [ ] **Step 1: 写失败的纯函数单测**

```kotlin
package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * CardTitleExtractor 纯函数测试——从卡片节点文本列表里挑 best-effort 标题。
 *
 * 真机根因 2026-07-19：VideoCardInfo.title 字段存在但从未被赋值，
 * acquisition_collect_videos.title 列因此永远是 null，"转写文案+title判定"
 * (2026-07-17决策，判定点1d078987) 的 title 信号从 Stage1 采集起就从未捕获过。
 *
 * 样本取自 DouyinCardClassifyTest 的真机 uiautomator dump 实测文本。
 */
class CardTitleExtractorTest {

    @Test
    fun `真机视频卡样本中最长文本是标题`() {
        val videoTexts = listOf(
            "01:34",
            "千呼万唤的一镜到底来啦～ 建面125套内100历时6个月花费10个装出的黑白灰极简小家 #装修 #一镜到底",
            "桃子的家🏠", "05.26", "5.9万",
        )
        assertEquals(
            "千呼万唤的一镜到底来啦～ 建面125套内100历时6个月花费10个装出的黑白灰极简小家 #装修 #一镜到底",
            CardTitleExtractor.pickTitle(videoTexts),
        )
    }

    @Test
    fun `真机图文卡样本中最长文本是标题`() {
        val noteTexts = listOf(
            "爸妈装的工业风，惊艳朋友圈！145㎡只花28W，水泥墙+原木搭配绝",
            "LJC-Designer", "2025.10.04", "3344",
        )
        assertEquals(
            "爸妈装的工业风，惊艳朋友圈！145㎡只花28W，水泥墙+原木搭配绝",
            CardTitleExtractor.pickTitle(noteTexts),
        )
    }

    @Test
    fun `空文本列表返回null`() {
        assertNull(CardTitleExtractor.pickTitle(emptyList()))
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.collect.CardTitleExtractorTest"`
Expected: FAIL（编译错误：`CardTitleExtractor` 不存在）

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/CardTitleExtractorTest.kt
git commit -m "test: CardTitleExtractor标题提取纯函数守卫（RED，title信号从未采集回归）"
```

- [ ] **Step 4: 实现 CardTitleExtractor.kt**

```kotlin
package com.zenithjoy.agent.collect

/**
 * CardTitleExtractor — 纯 Kotlin 卡片标题提取（无 Android 依赖，对齐 CardClassifier
 * 的纯函数可测试设计）。
 *
 * best-effort 启发式：卡片子树里最长的一条文本通常就是标题/文案 TextView
 * （真机 uiautomator dump 实测验证，见 DouyinCardClassifyTest 样本）——不保真，
 * 但优于完全没有 title 信号。
 */
object CardTitleExtractor {
    fun pickTitle(texts: List<String>): String? = texts.maxByOrNull { it.length }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.collect.CardTitleExtractorTest"`
Expected: PASS（3/3）

- [ ] **Step 6: 接入 DouyinCollectService.collectVideoCards()**

在 `DouyinCollectService.kt` 里新增一个 title 提取辅助函数，紧挨着 `classifyCardAtIndex()`（第 618-623 行）之后：

```kotlin
    // 与 classifyCardAtIndex 同样的卡片定位方式，取该卡子树文本列表中最长的一条作为
    // best-effort title（CardTitleExtractor 纯函数，真机 dump 样本验证过启发式有效）。
    // 找不到卡/root 时返回 null——title 是辅助信号，缺失不影响主链路。
    private fun extractTitleAtIndex(index: Int): String? {
        val root = rootInActiveWindow ?: return null
        val card = findVideoCards(root, MAX_VIDEOS_PER_SEARCH).getOrNull(index) ?: return null
        return CardTitleExtractor.pickTitle(collectNodeTexts(card))
    }
```

然后把第 583-592 行：

```kotlin
            val kind = classifyCardAtIndex(index)
            if (CardClassifier.shouldSkip(kind)) {
                android.util.Log.i(TAG, "Stage1 card#$index classified=$kind — skip（不点开/不计failure）")
                continue
            }
            val shareUrl = captureShareUrlForCard(index)
            pendingShareCapture = null
            pendingClearDone = null
            if (shareUrl != null) {
                collected.add(VideoCardInfo(videoId = "", keyword = currentKeyword, shareUrl = shareUrl))
```

改为：

```kotlin
            val kind = classifyCardAtIndex(index)
            if (CardClassifier.shouldSkip(kind)) {
                android.util.Log.i(TAG, "Stage1 card#$index classified=$kind — skip（不点开/不计failure）")
                continue
            }
            val title = extractTitleAtIndex(index)
            val shareUrl = captureShareUrlForCard(index)
            pendingShareCapture = null
            pendingClearDone = null
            if (shareUrl != null) {
                collected.add(VideoCardInfo(videoId = "", keyword = currentKeyword, title = title, shareUrl = shareUrl))
```

（`VideoCardInfo` data class 本身已有 `title: String? = null` 字段，见第 1735-1740 行，无需改动 data class 定义。）

- [ ] **Step 7: commit（commit-2 GREEN）**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/CardTitleExtractor.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "fix(agent-android): Stage1采集时提取best-effort title并落进VideoCardInfo"
```

---

### Task 4: 服务端 pending-collect-tasks 新增 video_titles

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`
- Test: `apps/api/tests/integration/p2-line02-content-judgment/pending-collect-tasks-video-titles.integration.test.ts`

**背景**：Stage1 采集把 title 落库后（Task 3），Stage2 判定时 Android 是靠 `GET /pending-collect-tasks` 拿到 `video_urls`（纯 URL 字符串数组），完全没有字段能把 title 带回 Android——即使库里有 title，判定时 Android 也拿不到。新增并列字段 `video_titles: Record<videoId, title>`，不改造现有 `video_urls` 结构（向后兼容旧版本 agent）。

- [ ] **Step 1: 写失败的集成测试（真连 zenithjoy_test）**

```typescript
/**
 * pending-collect-tasks 响应体须带 video_titles — [REGRESSION]
 *
 * 2026-07-19 根因排查：acquisition_collect_videos.title 列早已存在且 report-videos
 * 已支持写入，但 GET /pending-collect-tasks 的 stage_2 响应体只回传纯 URL 字符串数组
 * (video_urls)，没有任何字段能把 title 带回 Android——即使 Stage1 把 title 存进库了，
 * Stage2 判定时 Android 侧依然拿不到，"转写文案+title判定"(判定点1d078987)的 title
 * 信号在这一步断链。
 *
 * commit-1 时 RED（video_titles 字段不存在于响应体）；commit-2 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';
import { testPool, createTestTenant } from '../helpers';

let tenantId: string;
let agentId: string;
let taskId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

beforeAll(async () => {
  const tenant = await createTestTenant(`pending-tasks-titles-test-${RND}`);
  tenantId = tenant.id;

  const aRes = await testPool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, os_type, capabilities, last_heartbeat_at)
     VALUES ($1, $2, 'pending-tasks-titles-host', 'online', 'android', ARRAY['android'], NOW())
     RETURNING id`,
    [tenantId, `pending-tasks-titles-agent-${RND}`],
  );
  agentId = aRes.rows[0].id;

  const tRes = await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status, agent_id)
     VALUES ($1, $2::jsonb, 'stage_1_done', $3)
     RETURNING id`,
    [tenantId, JSON.stringify(['装修']), `pending-tasks-titles-agent-${RND}`],
  );
  taskId = tRes.rows[0].id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, title)
     VALUES ($1, $2, $3, $4)`,
    [`ptt-vid-${RND}`, taskId, tenantId, '真实标题测试样本'],
  );
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('GET /pending-collect-tasks video_titles [REGRESSION]', () => {
  it('stage_2 任务响应体须带 video_titles，videoId→title 与库里一致', async () => {
    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', `pending-tasks-titles-agent-${RND}`);

    expect(res.status).toBe(200);
    const task = res.body.tasks.find((t: { task_id: string }) => t.task_id === taskId);
    expect(task).toBeDefined();
    expect(task.stage).toBe('stage_2');
    expect(task.video_titles).toBeDefined();
    expect(task.video_titles[`ptt-vid-${RND}`]).toBe('真实标题测试样本');
  });
});
```

`apps/api/src/app.ts` 用 `export default app`（已核实，`apps/api/tests/content-images.test.ts:6` 等既有测试均用 `import app from '../src/app'` 这种默认导入 + supertest 打真实路由），本目录 `p2-line02-content-judgment/` 下现有两个集成测试都是直接调 service 函数/查库，没有 HTTP 层先例——本测试是本目录第一个经路由层的集成测试，用 supertest 是仓库里已验证过的正确方式（不是新引入的基础设施）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npm run test:integration -- pending-collect-tasks-video-titles.integration.test.ts`
Expected: FAIL（`task.video_titles` 为 `undefined`）

- [ ] **Step 3: 加入 test-registry.yaml + commit（commit-1 RED）**

```bash
# 在 test-registry.yaml 里给新测试文件加一条注册项（照现有条目格式，CI Orphan Test Check 强制要求）
git add apps/api/tests/integration/p2-line02-content-judgment/pending-collect-tasks-video-titles.integration.test.ts test-registry.yaml
git commit -m "test: pending-collect-tasks须回传video_titles（RED，Stage2判定title断链回归）"
```

- [ ] **Step 4: 服务端实现**

在 `apps/api/src/routes/acquisition.ts` 里，把第 287-294 行：

```typescript
      const vRes = await pool.query<{ task_id: string; video_id: string }>(
        `SELECT task_id, video_id FROM zenithjoy.acquisition_collect_videos
          WHERE task_id = ANY($1::uuid[])
            AND comments_reported_at IS NULL
            AND judgment_status != 'rejected'
          ORDER BY created_at ASC`,
        [stage1DoneRows.map((r) => r.id)]
      );
      const pendingByTask: Record<string, string[]> = {};
      for (const v of vRes.rows) {
        (pendingByTask[v.task_id] ??= []).push(v.video_id);
      }
```

改为：

```typescript
      const vRes = await pool.query<{ task_id: string; video_id: string; title: string | null }>(
        `SELECT task_id, video_id, title FROM zenithjoy.acquisition_collect_videos
          WHERE task_id = ANY($1::uuid[])
            AND comments_reported_at IS NULL
            AND judgment_status != 'rejected'
          ORDER BY created_at ASC`,
        [stage1DoneRows.map((r) => r.id)]
      );
      const pendingByTask: Record<string, string[]> = {};
      // 表主键是 (task_id, video_id)（2026-07-10 迁移 20260710_150000_collect_videos_composite_pk.sql
      // 改的，同一 video_id 可能出现在不同 task 里且 title 不同）——titleByTaskAndVideo 必须按
      // task_id 分桶，不能用全局 Record<videoId, title> 扁平存（会导致跨任务串 title）。
      const titleByTaskAndVideo: Record<string, Record<string, string>> = {};
      for (const v of vRes.rows) {
        (pendingByTask[v.task_id] ??= []).push(v.video_id);
        if (v.title) (titleByTaskAndVideo[v.task_id] ??= {})[v.video_id] = v.title;
      }
```

把第 282 行：

```typescript
    const videoMap: Record<string, string[]> = {};
```

改为：

```typescript
    const videoMap: Record<string, string[]> = {};
    const videoTitlesMap: Record<string, Record<string, string>> = {};
```

把第 333-339 行：

```typescript
        // Bug C：note 图文类型走 /note/ 深链，其余默认 /video/
        const mediaKinds = r.checkpoint?.media_kinds ?? {};
        videoMap[r.id] = dispatchable.map((vid) =>
          mediaKinds[vid] === 'note'
            ? `https://www.douyin.com/note/${vid}`
            : `https://www.douyin.com/video/${vid}`,
        );
      }
```

改为：

```typescript
        // Bug C：note 图文类型走 /note/ 深链，其余默认 /video/
        const mediaKinds = r.checkpoint?.media_kinds ?? {};
        videoMap[r.id] = dispatchable.map((vid) =>
          mediaKinds[vid] === 'note'
            ? `https://www.douyin.com/note/${vid}`
            : `https://www.douyin.com/video/${vid}`,
        );
        // title 随 URL 并列回传（videoId → title），Android AcquisitionCollectPollLoop
        // 靠它把 title 透传进 /judge-video——title 是"转写文案+title判定"(判定点1d078987)
        // 的第二个信号，2026-07-19 前 Stage2 判定时 Android 完全拿不到这个字段。
        const taskTitles = titleByTaskAndVideo[r.id] ?? {};
        const titles: Record<string, string> = {};
        for (const vid of dispatchable) {
          if (taskTitles[vid]) titles[vid] = taskTitles[vid];
        }
        videoTitlesMap[r.id] = titles;
      }
```

把第 343-349 行：

```typescript
    const tasks = rows.filter((r) => !exhaustedTaskIds.has(r.id)).map((r) => ({
      task_id: r.id,
      tenant_id: r.tenant_id,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      stage: r.status === 'stage_1_done' ? ('stage_2' as const) : ('stage_1' as const),
      video_urls: r.status === 'stage_1_done' ? (videoMap[r.id] ?? []) : undefined,
    }));
```

改为：

```typescript
    const tasks = rows.filter((r) => !exhaustedTaskIds.has(r.id)).map((r) => ({
      task_id: r.id,
      tenant_id: r.tenant_id,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      stage: r.status === 'stage_1_done' ? ('stage_2' as const) : ('stage_1' as const),
      video_urls: r.status === 'stage_1_done' ? (videoMap[r.id] ?? []) : undefined,
      video_titles: r.status === 'stage_1_done' ? (videoTitlesMap[r.id] ?? {}) : undefined,
    }));
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/api && npm run test:integration -- pending-collect-tasks-video-titles.integration.test.ts`
Expected: PASS

- [ ] **Step 6: commit（commit-2 GREEN）**

```bash
git add apps/api/src/routes/acquisition.ts
git commit -m "fix(api): pending-collect-tasks响应体新增video_titles，把title从库里带回Android"
```

---

### Task 5: Android 侧解析 video_titles 并透传给 judge()

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoop.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ContentJudgmentService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AudioJudgmentTest.kt`（追加用例）

- [ ] **Step 1: 在现有 AudioJudgmentTest.kt 里追加失败用例**

在 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AudioJudgmentTest.kt` 文件末尾（`}` 收尾前，紧接第 200 行的测试之后）追加：

```kotlin

    @Test
    fun `stage_2响应体带video_titles时judge-video请求体透传对应title`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t2","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v002"],
                    "video_titles":{"v002":"真实标题测试样本"}}]}"""
            )
        )
        val capturedBodies = mutableListOf<String>()
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBodies.add(buffer.readUtf8())
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val judgmentService = ContentJudgmentService(
            agentId = { "AG-TEST-002" },
            httpBase = "http://localhost:9",
            tenantId = { "tenant-1" },
            httpClient = judgeClient,
            screenCaptureService = ScreenCaptureService(captureImpl = { "fakeScreenshotBase64" }),
            audioCaptureService = AudioCaptureService(captureImpl = { "fakeAudioBase64" }),
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-002" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = CoroutineScope(Dispatchers.Unconfined),
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { },
        )
        loop.pollOnce()

        assertEquals(1, capturedBodies.size)
        assertTrue(
            "video_titles里对应videoId的title必须透传进judge-video请求体: ${capturedBodies[0]}",
            capturedBodies[0].contains("\"title\":\"真实标题测试样本\""),
        )
    }

    @Test
    fun `video_titles缺少某videoId时不报错也不带title字段`() {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[{"task_id":"t3","stage":"stage_2","status":"pending",
                    "video_urls":["https://www.douyin.com/video/v003"],
                    "video_titles":{}}]}"""
            )
        )
        val capturedBodies = mutableListOf<String>()
        val judgeClient = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val req = chain.request()
                val buffer = Buffer()
                req.body?.writeTo(buffer)
                capturedBodies.add(buffer.readUtf8())
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"judgment_status":"matched"}""".toResponseBody("application/json".toMediaType()))
                    .build()
            })
            .build()
        val judgmentService = ContentJudgmentService(
            agentId = { "AG-TEST-003" },
            httpBase = "http://localhost:9",
            tenantId = { "tenant-1" },
            httpClient = judgeClient,
            screenCaptureService = ScreenCaptureService(captureImpl = { "fakeScreenshotBase64" }),
            audioCaptureService = AudioCaptureService(captureImpl = { "fakeAudioBase64" }),
        )
        val loop = AcquisitionCollectPollLoop(
            agentId = { "AG-TEST-003" },
            httpBase = server.url("/").toString().trimEnd('/'),
            scope = CoroutineScope(Dispatchers.Unconfined),
            intervalMs = Long.MAX_VALUE,
            httpClient = OkHttpClient(),
            contentJudgmentService = judgmentService,
            videoOpener = { },
        )
        loop.pollOnce()

        assertEquals(1, capturedBodies.size)
        assertFalse(
            "video_titles里没有的videoId不应该带title字段: ${capturedBodies[0]}",
            capturedBodies[0].contains("\"title\""),
        )
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AudioJudgmentTest"`
Expected: FAIL（编译错误：`CollectTask` 没有 `video_titles` 属性 / `judge()` 没有 `title` 形参）

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AudioJudgmentTest.kt
git commit -m "test: video_titles透传进judge-video请求体守卫（RED，title信号Stage2断链回归）"
```

- [ ] **Step 4: 实现 — AcquisitionCollectPollLoop.kt**

把第 59-66 行：

```kotlin
    private data class CollectTask(
        val task_id: String = "",
        val stage: String = "",
        val status: String = "",
        val keywords: List<String>? = null,
        val video_urls: List<String>? = null,
        val checkpoint: Map<String, Any>? = null,
    )
```

改为：

```kotlin
    private data class CollectTask(
        val task_id: String = "",
        val stage: String = "",
        val status: String = "",
        val keywords: List<String>? = null,
        val video_urls: List<String>? = null,
        val video_titles: Map<String, String>? = null,
        val checkpoint: Map<String, Any>? = null,
    )
```

把第 136-153 行：

```kotlin
                    val eligibleUrls = if (contentJudgmentService != null) {
                        videoUrls.filter { videoUrl ->
                            val videoId = videoUrl.substringAfterLast("/")
                            // 先打开这张视频卡片，采集判决时屏幕上必须是它，不是搜索结果页
                            videoOpener?.invoke(videoId)
                            val result = contentJudgmentService.judge(
                                videoId = videoId,
                                // 用户2026-07-17拍板（判定点1d078987）：video 类型走音频转写判定，
                                // note(图文) 类型仍走截图判定（decision f3dbc2ce 两条路径分工不同）。
                                captureType = captureTypeForVideoUrl(videoUrl),
                                dataB64 = "", // 实际截图/录音由 ContentJudgmentService 内部采集
                            )
                            // rejected → 不进评论抓取；matched 或 pending（超时兜底）→ 继续
                            result.judgmentStatus != "rejected"
                        }
                    } else {
                        videoUrls
                    }
```

改为：

```kotlin
                    val eligibleUrls = if (contentJudgmentService != null) {
                        videoUrls.filter { videoUrl ->
                            val videoId = videoUrl.substringAfterLast("/")
                            // 先打开这张视频卡片，采集判决时屏幕上必须是它，不是搜索结果页
                            videoOpener?.invoke(videoId)
                            val result = contentJudgmentService.judge(
                                videoId = videoId,
                                // 用户2026-07-17拍板（判定点1d078987）：video 类型走音频转写判定，
                                // note(图文) 类型仍走截图判定（decision f3dbc2ce 两条路径分工不同）。
                                captureType = captureTypeForVideoUrl(videoUrl),
                                dataB64 = "", // 实际截图/录音由 ContentJudgmentService 内部采集
                                // title 随 pending-collect-tasks 响应体的 video_titles 一起回传，
                                // 缺失时为 null（判定 prompt 退化为无 title 版文案，不强行拼接）。
                                title = task.video_titles?.get(videoId),
                            )
                            // rejected → 不进评论抓取；matched 或 pending（超时兜底）→ 继续
                            result.judgmentStatus != "rejected"
                        }
                    } else {
                        videoUrls
                    }
```

- [ ] **Step 5: 实现 — ContentJudgmentService.kt**

把第 64-70 行：

```kotlin
    fun judge(
        videoId: String,
        captureType: String = "screenshot",
        dataB64: String,
        forceResult: String? = null,
        forceTimeout: Boolean = false,
    ): JudgmentResult {
```

改为：

```kotlin
    fun judge(
        videoId: String,
        captureType: String = "screenshot",
        dataB64: String,
        forceResult: String? = null,
        forceTimeout: Boolean = false,
        title: String? = null,
    ): JudgmentResult {
```

把第 105-112 行：

```kotlin
        val payload = buildPayload(
            tenantId = currentTenantId,
            videoId = videoId,
            captureType = actualCaptureType,
            dataB64 = actualDataB64,
            forceResult = forceResult,
            forceTimeout = forceTimeout,
        )
```

改为：

```kotlin
        val payload = buildPayload(
            tenantId = currentTenantId,
            videoId = videoId,
            captureType = actualCaptureType,
            dataB64 = actualDataB64,
            forceResult = forceResult,
            forceTimeout = forceTimeout,
            title = title,
        )
```

把第 142-159 行：

```kotlin
    private fun buildPayload(
        tenantId: String,
        videoId: String,
        captureType: String,
        dataB64: String,
        forceResult: String?,
        forceTimeout: Boolean,
    ): String {
        val obj = JSONObject().apply {
            put("tenant_id", tenantId)
            put("video_id", videoId)
            put("capture_type", captureType)
            put("data_b64", dataB64)
            if (forceResult != null) put("force_result", forceResult)
            if (forceTimeout) put("force_timeout", true)
        }
        return obj.toString()
    }
```

改为：

```kotlin
    private fun buildPayload(
        tenantId: String,
        videoId: String,
        captureType: String,
        dataB64: String,
        forceResult: String?,
        forceTimeout: Boolean,
        title: String?,
    ): String {
        val obj = JSONObject().apply {
            put("tenant_id", tenantId)
            put("video_id", videoId)
            put("capture_type", captureType)
            put("data_b64", dataB64)
            if (forceResult != null) put("force_result", forceResult)
            if (forceTimeout) put("force_timeout", true)
            if (title != null) put("title", title)
        }
        return obj.toString()
    }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AudioJudgmentTest"`
Expected: PASS（全部用例，含 Task 5 新增的 2 条）

- [ ] **Step 7: commit（commit-2 GREEN）**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoop.kt services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ContentJudgmentService.kt
git commit -m "fix(agent-android): judge()透传title，pending-collect-tasks的video_titles接进judge-video请求体"
```

---

### Task 6: 服务端 judge-video 路由 + content-judgment.ts 透传 title 并改 prompt

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`
- Modify: `apps/api/src/services/content-judgment.ts`
- Test: `apps/api/src/services/content-judgment.test.ts`（追加用例）

- [ ] **Step 1: 在现有 content-judgment.test.ts 里追加失败用例**

在 `apps/api/src/services/content-judgment.test.ts` 文件末尾（第 196-197 行的 `});` 之后、`describe` 块收尾 `});` 之前）追加：

```typescript

  /**
   * 回归（2026-07-19）：audio 分支必须把 title 塞进 prompt，指示 Gemini "先转写再判断"。
   * 2026-07-17 决策(判定点1d078987)只完成了客户端路由分流，服务端 buildPrompt 从未
   * 真正用上 title、也没有"先转写"指令——单次多模态调用内完成转写+判定两步，不新增
   * 独立转写API调用。
   */
  it('回归: audio分支prompt须含title并指示先转写再判定', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-title-001',
      'video-title-001',
      'audio',
      btoa('fake-pcm-wav-data'),
      undefined,
      undefined,
      '千呼万唤的一镜到底来啦～黑白灰极简小家装修',
    );

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    const messages = body.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content.find((p) => p.type === 'text')?.text ?? '';
    expect(promptText).toContain('千呼万唤的一镜到底来啦～黑白灰极简小家装修');
    expect(promptText).toContain('转写');
  });

  it('回归: audio分支title为空时不强行拼接空标题', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-title-002',
      'video-title-002',
      'audio',
      btoa('fake-pcm-wav-data'),
    );

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    const messages = body.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content.find((p) => p.type === 'text')?.text ?? '';
    expect(promptText).not.toContain('《undefined》');
    expect(promptText).not.toContain('《null》');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npm test -- content-judgment.test.ts`
Expected: FAIL（`judgeVideo` 函数签名目前只有 7 个位置参数，第 8 个 title 实参会被 TypeScript 类型检查拒绝 / prompt 里不含 title 文本）

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add apps/api/src/services/content-judgment.test.ts
git commit -m "test: audio分支prompt须含title+先转写指令（RED，2026-07-17决策未完整落地回归）"
```

- [ ] **Step 4: 实现 — content-judgment.ts**

把第 47-55 行：

```typescript
export async function judgeVideo(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  forceResult?: 'matched' | 'rejected' | 'pending',
  forceTimeout?: boolean,
): Promise<JudgeVideoResult> {
```

改为：

```typescript
export async function judgeVideo(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  forceResult?: 'matched' | 'rejected' | 'pending',
  forceTimeout?: boolean,
  title?: string,
): Promise<JudgeVideoResult> {
```

把第 112 行：

```typescript
  return await callGemini(pool, tenantId, videoId, captureType, dataB64, targetProfileDesc);
```

改为：

```typescript
  return await callGemini(pool, tenantId, videoId, captureType, dataB64, targetProfileDesc, title);
```

把第 116-123 行：

```typescript
async function callGemini(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  targetProfileDesc: string,
): Promise<JudgeVideoResult> {
```

改为：

```typescript
async function callGemini(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  targetProfileDesc: string,
  title?: string,
): Promise<JudgeVideoResult> {
```

把第 131 行：

```typescript
  const prompt = buildPrompt(targetProfileDesc, captureType);
```

改为：

```typescript
  const prompt = buildPrompt(targetProfileDesc, captureType, title);
```

把第 175-192 行：

```typescript
function buildPrompt(targetProfileDesc: string, captureType: string): string {
  const mediaDesc = captureType === 'audio' ? '音频片段' : '屏幕截图';
  return `你是一个内容判决助手。根据以下目标客户画像，判断这段${mediaDesc}中的内容是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果无法判断，回复：MATCHED（保守策略，不漏过潜在客户）

请严格按格式回复，第一行必须是 MATCHED 或 REJECTED，如果是 REJECTED 则第二行说明原因：
MATCHED
或
REJECTED
原因：...`;
}
```

改为：

```typescript
function buildPrompt(targetProfileDesc: string, captureType: string, title?: string): string {
  // 用户2026-07-17拍板（判定点1d078987，decision f3dbc2ce）：video 类型走音频转写判定——
  // 先转写这段音频内容，再结合视频标题和转写文案共同判断，单次多模态调用内完成
  // 转写+判定两步，不新增独立转写API调用（避免过度设计成两阶段架构）。
  const mediaInstruction =
    captureType === 'audio'
      ? title
        ? `这是一段视频开头20秒的音频片段，视频标题是《${title}》。请先在心里转写这段音频的内容，再结合标题和转写内容共同判断`
        : `这是一段视频开头20秒的音频片段。请先在心里转写这段音频的内容，再结合转写内容判断`
      : '判断这段屏幕截图中的内容是否匹配目标客户群体';
  return `你是一个内容判决助手。根据以下目标客户画像，${mediaInstruction}是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果无法判断，回复：MATCHED（保守策略，不漏过潜在客户）

请严格按格式回复，第一行必须是 MATCHED 或 REJECTED，如果是 REJECTED 则第二行说明原因：
MATCHED
或
REJECTED
原因：...`;
}
```

- [ ] **Step 5: 实现 — judge-video 路由（acquisition.ts）**

把第 1156-1162 行：

```typescript
  const {
    video_id: videoId,
    capture_type: captureType,
    data_b64: dataB64,
    force_result: forceResult,
    force_timeout: forceTimeout,
  } = req.body ?? {};
```

改为：

```typescript
  const {
    video_id: videoId,
    capture_type: captureType,
    data_b64: dataB64,
    force_result: forceResult,
    force_timeout: forceTimeout,
    title,
  } = req.body ?? {};
```

把第 1174-1183 行：

```typescript
  try {
    const result = await judgeVideo(
      pool,
      tenantId,
      videoId,
      captureType,
      dataB64,
      forceResult,
      forceTimeout === true,
    );
```

改为：

```typescript
  try {
    const result = await judgeVideo(
      pool,
      tenantId,
      videoId,
      captureType,
      dataB64,
      forceResult,
      forceTimeout === true,
      typeof title === 'string' ? title : undefined,
    );
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd apps/api && npm test -- content-judgment.test.ts`
Expected: PASS（全部用例，含 Task 6 新增的 2 条）

- [ ] **Step 7: commit（commit-2 GREEN）**

```bash
git add apps/api/src/services/content-judgment.ts apps/api/src/routes/acquisition.ts
git commit -m "fix(api): judge-video/buildPrompt透传title，audio分支prompt改为先转写再结合title判定"
```

---

## 收尾

- [ ] 全量跑一次 `cd apps/api && npm test` 确认无回归
- [ ] 全量跑一次 `cd services/agent-android && ./gradlew testDebugUnitTest` 确认无回归
- [ ] 用 `superpowers:finishing-a-development-branch` 收尾（Tier-1 自主默认 Option 2：push + PR）
