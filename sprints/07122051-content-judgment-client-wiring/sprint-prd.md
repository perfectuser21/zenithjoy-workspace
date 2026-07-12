# Sprint PRD: 内容判决客户端接线

**Sprint ID**: 07122051-content-judgment-client-wiring
**Task ID**: 31e29c09-ba47-4962-96a2-e46e36890cba
**Journey**: Path 2 客户智能获客（afa6abca-53c0-4815-8594-b7fb81ca547f）
**Feature ID**: 2a23912e-cfbe-41a7-adc6-81167818ec43
**日期**: 2026-07-12

## 目标

Android Agent 端接入 MediaProjection 真实截图捕获，接线既有 /judge-video API，使
judgment_status 能从 pending 真正流转为 matched/rejected，让内容判定门槛在生产链路生效。

## 问题根因（两处断线）

1. `AgentService.kt` 创建 `AcquisitionCollectPollLoop` 时未传 `contentJudgmentService`（null）
   → 所有视频绕过判决直接进 Stage2
2. `AcquisitionCollectPollLoop` 调用 `contentJudgmentService.judge(dataB64 = "")` 是空字符串
   → 截图数据根本未捕获

## Invariant 约束

- **INV-1**: rejected 视频不得生成 Stage2 任务（acquisitions 不得进入 Stage2 流水线）
- **INV-3**: 单视频判决超时 8s 不阻塞其他视频处理（超时 → pending，不 block 主循环）
- **INV-4**: skipped_capture_failed 视频必须有 collect_videos 记录（不得静默丢弃）

## 累积 FR

- **FR-A**: AgentService 实例化 ContentJudgmentService 并注入 ScreenCaptureService，将
  contentJudgmentService 非 null 传入 AcquisitionCollectPollLoop
- **FR-B**: 新建 `ScreenCaptureService.kt`，持有 MediaProjection 实例，提供
  `captureToBase64(): String?`（ImageReader + VirtualDisplay → JPEG quality=70 → base64；
  失败返回 null）
- **FR-C**: ContentJudgmentService 新增构造参数 `screenCaptureService: ScreenCaptureService? = null`；
  `judge()` 内：若 dataB64 为空 → 调 captureToBase64()；截图失败 → captureType =
  "skipped_capture_failed" 走原有失败路径
- **FR-D**: 截图成功后 dataB64 非空，/judge-video API 收到真实 base64 数据（非空字符串）
- **FR-E**: AndroidManifest.xml 新增 `FOREGROUND_SERVICE_MEDIA_PROJECTION` 权限声明
- **FR-F**: MainActivity 调用 `createScreenCaptureIntent` 请求 MediaProjection 授权，
  收到授权后将 MediaProjection 实例传给 AgentService

## NFR

- 截图失败不崩溃，fallback 到 skipped_capture_failed + pending 状态
- 判决超时 8s 不阻塞（ContentJudgmentService 已有实现，保持不变）
- ScreenCaptureService 必须在 foreground service 内持有 MediaProjection（系统要求）
- 单元测试：JVM 纯 Kotlin 测试，不需要真实设备

## 关键文件

**修改**：
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ContentJudgmentService.kt`
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt`
- `services/agent-android/app/src/main/AndroidManifest.xml`

**新建**：
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/ScreenCaptureService.kt`
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/ContentJudgmentClientWiringTest.kt`

**不改**：
- API 侧 `/judge-video` 端点（上一 sprint 已完成）
- DB migrations（上一 sprint 已落地）
- `AcquisitionCollectPollLoop.kt` 调用 judge 的结构（dataB64 有值即可）

## E2E 验收

单元测试（JVM）覆盖：
1. ContentJudgmentService 收到空 dataB64 时调用 screenCaptureService.captureToBase64()
2. captureToBase64() 返回 null 时 captureType = "skipped_capture_failed"
3. captureToBase64() 返回非空 base64 时 dataB64 传入 /judge-video API
4. AgentService 创建的 contentJudgmentService 实例非 null

## Sprint 推进声明

本 sprint 把 Path 2 Step 3（Android 端 Agent 连中台内容判决）从 🔴 断线推到 ✅ 接通。

journey_type: user_facing
target_environment: windows_cloud
