# Bug PrepPRD：line02 安卓账号扫描 OPEN_PANEL_FAILED nightly 连红——诊断证据本身失效，先修诊断盲区

## 症状
pc4 手机池夜间账号扫描回归车道（`nightly-android-fleet-pc4.yml`）过去10天(08-03~08-13)几乎全红，报错 `error_code=OPEN_PANEL_FAILED`。从 staging DB 拉取失败任务真实 response 发现：失败瞬间设备已成功导航到抖音"我"页面，"切换账号"节点在无障碍树里可见且 clickable，但点击后 3.2 秒轮询窗口内没等到账号切换面板出现。**无法进一步实锤根因**，因为诊断截图（`captureFailureDiagnostics()`）本身失效——`screenshot_b64` 恒为 null，且诊断遥测里从未记录过设备上抖音 App 的真实版本号（代码逻辑假设"抖音39.4.0"，无法验证是否已因真机自动更新漂移）。

## 根因假设
1. `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt:831` `captureFailureDiagnostics()` 调用 `AgentService.sharedScreenCaptureService?.captureToBase64()` 静默吞掉三种不同失败原因（服务未初始化 / MediaProjection 权限未授予 / 截图过程真异常），全部退化成同一个 `null`，且日志里也无法区分——导致每一次 OPEN_PANEL_FAILED 现场都是"诊断致盲"状态，历史上从未有一次真正靠截图定位过根因。
2. 诊断广播（`sendScanResultBroadcast`）只携带 Agent 自身 `BuildConfig.VERSION_NAME`，从未采集设备上抖音 App 的真实 `versionName`——面板判定逻辑（`awaitSwitchAccountPanel()` 查 resource-id `com.ss.android.ugc.aweme:id/recycler_view`）是对着历史某个抖音版本实测硬编码的，真机长期自动更新，无法验证当前是否漂移。

## 关联上下文
- 相关 Journey/Ability：line02 智能获客 / keyword_acquisition golden path（`.github/workflows/scripts/smoke/golden-path-2-smoke.sh`）
- 相关真机车道：`.github/workflows/nightly-android-fleet-pc4.yml` + `.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh`
- 历史同类修复：PR#1523(我tab点击等待)、PR#1554(误触发更换背景浮层)、sprint 08031620(锁屏/后台拦截分层)——均为"这台设备这次症状"专属修复，未系统化解决诊断盲区问题
- 并行动作：已同时派真机 SSH 会话现场复现（adb logcat + uiautomator dump + 抖音真实版本号核对），本 PR 范围不等真机会话结果，先堵住诊断盲区本身

## 修法
1. `DeviceAccountScanService.kt` `captureFailureDiagnostics()`：拆分三种失败原因为独立可观测状态（`service_null` / `capture_returned_null` / `capture_threw:<message>`），写入日志 tag `DeviceAccountScanSvc`，并通过新增字段 `screenshotFailureReason` 一并广播（不影响现有 `screenshotB64` 字段语义）。
2. `sendScanResultBroadcast()` 新增可选 extra 字段 `EXTRA_DOUYIN_VERSION_NAME`，在 `captureFailureDiagnostics()` 同一调用点用 `packageManager.getPackageInfo(DOUYIN_PKG, 0).versionName` 采集抖音真实版本号（读取失败不阻塞，捕获异常返回 null）。
3. 服务端 `agent-burner.ts` 回调路由透传新字段进 `publish_tasks.response`（不改变现有字段结构，新增字段）。

## Regression Test 计划
- `DeviceAccountScanServiceDiagnosticFieldsCallSiteTest.kt`（已存在同名测试文件，扩展用例）：新增用例断言 `captureFailureDiagnostics()` 在 `sharedScreenCaptureService=null` / `captureToBase64()`返回null` / `captureToBase64()`抛异常` 三种场景下产生三种不同的 `screenshotFailureReason` 字符串，而不是统一坍缩成不可区分的 null。
- 新增用例断言 OPEN_PANEL_FAILED/READ_FAILED 调用点广播携带 `EXTRA_DOUYIN_VERSION_NAME`（`getPackageInfo` mock 返回固定版本号，断言透传）。
- 该 test 修完后**永久留在 CI**（`app/build.gradle` 现有 unit test 任务），不删除。

> ⚠️ 修完必须配 proven-to-fire 守卫：故意让 `captureToBase64()` mock 返回 null / 抛异常两种场景各跑一次，亲眼看断言真的能抓出"坍缩成同一个原因"的旧代码（即先在旧代码上跑一次新 test 确认它红，再上新代码转绿）。

## 验收标准
- [ ] failing test 先 commit（commit-1）：证明旧代码把三种失败原因坍缩成同一个不可区分状态
- [ ] 修复代码让 test 变绿（commit-2）：三种场景产生三个可区分的 `screenshotFailureReason`；广播新增抖音真实版本号
- [ ] `./gradlew :app:testDebugUnitTest` 本地/CI 全绿
- [ ] 不改变 `account-scan-realmachine-smoke.sh` 现有断言逻辑（本 PR 只加诊断遥测，不改判定逻辑，nightly 车道预期仍红——这是预期内的，真正转绿依赖并行进行的真机会话定位到的点击/面板检测根因，属于后续 PR）
