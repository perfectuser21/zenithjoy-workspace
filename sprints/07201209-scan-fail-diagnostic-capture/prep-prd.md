# 小改动 PrepPRD：账号扫描失败时自动截图+无障碍树摘要上报

## 改什么

`DeviceAccountScanService` 在 `OPEN_PANEL_FAILED`/`READ_FAILED` 时，额外捕获一次屏幕截图 + 当前无障碍树的结构化文本摘要，随结果上报一起送到服务端，落库存进 `publish_tasks.response`，供远程诊断任意客户机型/抖音版本的真实失败原因（不用再靠猜坐标）。

**三处联动**（复用现成基础设施，不新造轮子——已用 Explore agent 查过全仓库，以下三块都有现成可复用实现）：

1. **截图**：复用已有的 `ScreenCaptureReal.buildCaptureImpl` + `MediaProjectionHolder` + `ScreenCaptureService`（`ContentJudgmentService.kt`/`AgentService.kt:403-407` 已在用同一套，产出 720px 长边、JPEG quality 70 的 base64 字符串）。`DeviceAccountScanService` 本身是 `AccessibilityService`（也是 `Context`），直接可以构造一个自己的 `ScreenCaptureService` 实例调用 `captureToBase64()`。若用户从未在 `MainActivity` 授权过 MediaProjection，返回 `null`——降级为"无截图但仍正常上报文字诊断"，不阻塞既有失败上报流程。

2. **无障碍树摘要**：现有 `DouyinCollectService.kt` 的 `dumpNodeDescs` 只打日志不返回值，仿照它的字段集（className/`viewIdResourceName`/isClickable/bounds/text/contentDescription）新写一个返回 `String` 的版本（放 `DeviceAccountScanService.kt`，不复用 `dumpNodeDescs` 本体，避免跨 service 耦合），节点数加上限（如80个）控制体积。

3. **上传通道**：复用已验证可用的 base64-in-JSON 模式（同 `ContentJudgmentService` 上报截图给 `judge-video` 端点的做法），不用本仓库那套"只在本地写盘、从没真正传出设备"的 `screenshot_path` 模式（Explore agent 已确认那套对客户机不可用）。具体：
   - `DeviceAccountScanService.sendScanResultBroadcast` 新增两个可选 Intent extra：`EXTRA_SCREENSHOT_B64`、`EXTRA_TREE_DUMP`，仅在 `errorCode` 非空时才真正捕获+填充（成功场景不产生额外开销）
   - `AgentService` 的 `accountScanResultReceiver` 读出这两个 extra，透传给 `reportAccountScanResult`/`buildAccountScanResultBody`（手写 JSON 拼接，`esc()` 对 tree_dump 做转义；`screenshot_b64` 是纯 base64 字符集不需要转义，但仍需判空处理）
   - 服务端 `apps/api/src/routes/agent-burner.ts` 的 `/account-scan-result`：解构新增 `screenshot_b64`、`tree_dump`，写进 `UPDATE publish_tasks SET response=...` 的 JSON 里（跟已有的 `ok`/`account_ids`/`error_code` 一起）

## 为什么改

真人真机测试用户当面指出：现有 `openSwitchAccountPanel()` 是在一台参考机（荣耀，抖音39.4.0）上手调出来的写死坐标比例，对客户随便什么手机型号/抖音版本根本不泛化——这是设计缺陷，不是这台测试机的个例问题。用户明确拍板：不要再猜坐标改自动化逻辑，先拿到失败现场的真实证据（截图+无障碍树），再决定怎么改自动化本身。

## 关联上下文
- 相关 Journey：客户智能获客路径（afa6abca-53c0-4815-8594-b7fb81ca547f），Path2 Step 7
- 相关 PR：#1424（手动触发通道）、#1428（补 error_code 落库，本次直接在其基础上扩展 response 字段）
- 今天正在进行的真机联调，P0，用户当场等结果

## 影响范围
- 不改 `openSwitchAccountPanel`/`readAccountListFromPanel` 的自动化逻辑本身（本次只加诊断，不碰"猜坐标"那部分——那是下一步，要等这次的证据回来才能决定怎么改）
- 只在失败路径（`errorCode` 非空）触发截图+树摘要，成功路径零额外开销
- Express body limit 全局 `1mb`（`apps/api/app.ts:93`）：720px JPEG q70 base64 通常 <200KB + 树摘要文本几KB，预计安全落在限额内，不需要额外调大；若真机验证发现超限再处理

## 验收标准
- [ ] Android 单测：新的树摘要 dump 函数纯逻辑测试（构造 mock AccessibilityNodeInfo 树，断言输出格式）
- [ ] Android 单测：`buildAccountScanResultBody` 新增 `screenshot_b64`/`tree_dump` 参数后的 JSON 组装测试（同现有 `AgentServiceAccountScanTest.kt` 模式）
- [ ] API 单测：`/account-scan-result` 新字段落库测试（同已有 `agent-burner.test.ts` 模式）
- [ ] CI 全绿
- [ ] （真机验证，不阻塞本次PR，另行确认）staging部署后用户下一次真机失败尝试，能在 `publish_tasks.response` 里查到真实截图+树摘要
