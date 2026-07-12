# Contract Draft: 内容判决客户端接线

**Sprint ID**: 07122051-content-judgment-client-wiring
**Task ID**: 31e29c09-ba47-4962-96a2-e46e36890cba
**日期**: 2026-07-12
**版本**: v1

---

## 概述

Android Agent 端接入 MediaProjection 真实截图捕获并接线既有 /judge-video API，使 judgment_status 能从 pending 真正流转为 matched/rejected，修复两处断线（contentJudgmentService=null 及 dataB64="" 空字符串）。

---

## Invariant 约束

| INV | 描述 | 验证方式 |
|-----|------|---------|
| INV-1 | rejected 视频不得生成 Stage2 任务（不得进入 acquisitions Stage2 流水线） | 单元测试：mock judge 返回 rejected → 断言 Stage2 任务未创建 |
| INV-3 | 单视频判决超时 8s 不阻塞其他视频处理（超时 → pending，不 block 主循环） | 单元测试：mock judge 延迟 >8s → 断言超时后继续处理下一视频 |
| INV-4 | skipped_capture_failed 视频必须有 collect_videos 记录，不得静默丢弃 | 单元测试：captureToBase64() 返回 null → 断言 captureType="skipped_capture_failed" 且记录存在 |

---

## 功能需求（FR）覆盖

| FR | 描述 | 验收断言 |
|----|------|---------|
| FR-A | AgentService 实例化 ContentJudgmentService + ScreenCaptureService 并注入 AcquisitionCollectPollLoop（非 null） | 断言 AcquisitionCollectPollLoop 构造时 contentJudgmentService 参数非 null |
| FR-B | 新建 ScreenCaptureService.kt，通过可注入 lambda 持有截图实现，captureToBase64() 返回 JPEG/70/base64 或 null（见设计说明） | 单元测试：注入 fake lambda `{ "fakeBase64Data" }` → 验证返回非空；注入抛异常 lambda → 返回 null |
| FR-C | ContentJudgmentService.judge() 内 dataB64 为空时调用 captureToBase64()；失败时 captureType=skipped_capture_failed | 单元测试：传入空 dataB64 → 断言调用 screenCaptureService.captureToBase64()；返回 null → captureType=skipped_capture_failed |
| FR-D | 截图成功后 dataB64 非空传给 /judge-video API | 单元测试：captureToBase64() 返回 "base64data" → 断言 HTTP 请求 body 中 dataB64 非空 |
| FR-E | AndroidManifest.xml 新增 FOREGROUND_SERVICE_MEDIA_PROJECTION 权限声明 | 检查 AndroidManifest.xml 包含该权限声明 |
| FR-F | MainActivity 请求 MediaProjection 授权并将实例传给 AgentService | grep 验证：`grep -c "createScreenCaptureIntent\|MediaProjectionManager" .../MainActivity.kt` 输出 ≥1 |

---

## DB Schema 变更

本次无 DB Schema 变更。API 端点 /judge-video 已在上一 sprint 完成，本次仅接线客户端。

---

## Test Contract 表

| # | it() 名称子串 | 对应 INV/FR | 类型 | 可执行形式 |
|---|---------------|------------|------|-----------|
| 1 | `contentJudgmentService is not null when AcquisitionCollectPollLoop created` | FR-A | JVM 单元测试 | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.contentJudgmentService*"` |
| 2 | `captureToBase64 called when dataB64 is empty` | FR-C | JVM 单元测试 | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.captureToBase64 called*"` |
| 3 | `skipped_capture_failed when captureToBase64 returns null` | FR-C, INV-4 | JVM 单元测试 | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.skipped_capture_failed*"` |
| 4 | `non-empty dataB64 sent to judge-video when capture succeeds` | FR-D | JVM 单元测试 | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.non-empty dataB64*"` |
| 5 | `rejected video does not create stage2 task` | INV-1 | JVM 单元测试 | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.rejected video*"` |
| 6 | `judgment timeout does not block next video processing` | INV-3 | JVM 单元测试（使用 `captureType + forceTimeout=true` 触发超时路径，断言返回 `JudgmentResult(judgmentStatus="pending")`，不用真实 8s delay） | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.judgment timeout*"` |
| 7 | `ScreenCaptureService captureToBase64 returns null on exception` | FR-B | JVM 单元测试（lambda 注入：`ScreenCaptureService(captureImpl = { throw RuntimeException() })`，不依赖 MediaProjection） | `./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest.ScreenCaptureService*"` |

---

## E2E 验收

### 验证方案

本次变更为 Android 客户端纯 Kotlin 实现，无 API/DB 变更，E2E 形式为 **JVM 单元测试**。

**测试文件**：
```
services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/ContentJudgmentClientWiringTest.kt
```

**执行命令**：
```bash
cd services/agent-android
./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest*"
echo "Exit code: $?"
```

**CI 集成**：
- smoke 脚本：`.github/workflows/scripts/smoke/content-judgment-client-wiring-smoke.sh`
- 触发：`./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest*"`，断言 EXIT 0

### 验收通过条件

1. `ContentJudgmentClientWiringTest` 全部 7 条用例 PASS
2. `./gradlew :app:testDebugUnitTest` 整体 BUILD SUCCESSFUL
3. smoke 脚本 EXIT 0

---

## ScreenCaptureService 设计说明

`ScreenCaptureService` 是**普通 Kotlin 辅助类**（非 Android Service，不继承 Service 基类）：

```kotlin
class ScreenCaptureService(
    private val captureImpl: () -> String? = { /* 真实 MediaProjection 截图逻辑 */ null }
) {
    fun captureToBase64(): String? = captureImpl()
}
```

- MediaProjection 实例由 MainActivity 授权后传入，ScreenCaptureService 封装于其 lambda 中
- ScreenCaptureService 在 AgentService（已是前台服务）内使用，**不需要**自身成为前台服务
- **manifest 无需新增 `<service>` 声明**，只需 FR-E 的 `FOREGROUND_SERVICE_MEDIA_PROJECTION` 权限
- JVM 单元测试注入 fake lambda，**完全不依赖 MediaProjection**：
  ```kotlin
  val fakeCapture = ScreenCaptureService(captureImpl = { "fakeBase64Data" })
  val failingCapture = ScreenCaptureService(captureImpl = { throw RuntimeException("fail") })
  ```

---

## 实现范围边界

**本次修改**：
- `AgentService.kt`：实例化 ContentJudgmentService + ScreenCaptureService，注入 AcquisitionCollectPollLoop
- `ContentJudgmentService.kt`：新增 screenCaptureService 构造参数，judge() 内补截图逻辑
- `ScreenCaptureService.kt`：新建（普通 Kotlin 类），通过可注入 lambda 封装 MediaProjection 截图
- `MainActivity.kt`：请求 MediaProjection 授权，将实例传给 AgentService
- `AndroidManifest.xml`：新增 FOREGROUND_SERVICE_MEDIA_PROJECTION 权限（无需新增 `<service>` 声明）

**本次不改**：
- `/judge-video` API 端点
- DB migrations
- AcquisitionCollectPollLoop.kt 调用结构（dataB64 有值即通过）
