# Contract DoD: 内容判决客户端接线

**Sprint ID**: 07122051-content-judgment-client-wiring
**Task ID**: 31e29c09-ba47-4962-96a2-e46e36890cba
**日期**: 2026-07-12

---

## BEHAVIOR 条目

[BEHAVIOR] AgentService 实例化 ContentJudgmentService 并注入 AcquisitionCollectPollLoop，使 contentJudgmentService 参数非 null，所有视频不再绕过判决
[BEHAVIOR] ContentJudgmentService.judge() 收到空 dataB64 时，调用 ScreenCaptureService.captureToBase64() 获取真实截图数据，截图成功后以非空 base64 调用 /judge-video API
[BEHAVIOR] ScreenCaptureService.captureToBase64() 失败（异常/null）时，captureType 设为 skipped_capture_failed，视频 judgment_status 保持 pending，collect_videos 记录必须存在（INV-4）
[BEHAVIOR] rejected 视频不生成 Stage2 任务（INV-1），判决超时 8s 不阻塞主循环继续处理下一视频（INV-3）
[BEHAVIOR] AndroidManifest.xml 声明 FOREGROUND_SERVICE_MEDIA_PROJECTION 权限，MainActivity 请求 MediaProjection 授权并将实例传给 AgentService，ScreenCaptureService 在 foreground service 内持有 MediaProjection

---

## 验收命令

manual:bash cd /workspace/services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*ContentJudgmentClientWiringTest*" && echo "SMOKE_PASS"

---

## DoD 检查清单

- [ ] FR-A: AgentService 实例化 ContentJudgmentService + ScreenCaptureService，注入 AcquisitionCollectPollLoop（非 null）
- [ ] FR-B: 新建 ScreenCaptureService.kt，持有 MediaProjection，captureToBase64() 返回 JPEG/70/base64 或 null（失败不崩溃）
- [ ] FR-C: ContentJudgmentService.judge() 空 dataB64 时调用 captureToBase64()；失败时 captureType=skipped_capture_failed
- [ ] FR-D: 截图成功后 dataB64 非空传给 /judge-video API
- [ ] FR-E: AndroidManifest.xml 新增 FOREGROUND_SERVICE_MEDIA_PROJECTION 权限声明
- [ ] FR-F: MainActivity 请求 MediaProjection 授权并将实例传给 AgentService
- [ ] INV-1: 单元测试验证 rejected 视频不创建 Stage2 任务
- [ ] INV-3: 单元测试验证判决超时 8s 不阻塞主循环
- [ ] INV-4: 单元测试验证 skipped_capture_failed 时 collect_videos 记录存在
- [ ] 测试文件 `ContentJudgmentClientWiringTest.kt` 包含 ≥7 条用例，全部 PASS
- [ ] `./gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL
- [ ] smoke 脚本 `content-judgment-client-wiring-smoke.sh` 存在且 EXIT 0
- [ ] smoke-baseline.txt 已追加 `content-judgment-client-wiring-smoke.sh`
- [ ] PR 描述声明：「本 PR 把 Path 2 Step 3 从 🔴 断线推到 ✅ 接通」
- [ ] 无 console.log / 注释代码 / 未用 import 残留

---

## 关联

- Journey: Path 2 客户智能获客 Step 3（Android 端 Agent 连中台内容判决）
- Feature: content-judgment-gate（feature ID: 2a23912e-cfbe-41a7-adc6-81167818ec43）
- 上游 sprint: content-judgment-gate（API + DB 已完成）
- CI 环境: windows-latest runner（zenithjoy 约定）
