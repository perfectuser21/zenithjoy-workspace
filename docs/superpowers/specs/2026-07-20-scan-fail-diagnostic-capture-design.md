# 设计：账号扫描失败自动截图+无障碍树摘要上报

## 背景
`DeviceAccountScanService.openSwitchAccountPanel()` 是在单台参考机（荣耀，抖音39.4.0）手调坐标比例的实现，对客户任意机型/抖音版本不泛化。真人真机测试连续失败（`OPEN_PANEL_FAILED`），用户拍板：先拿失败现场真实证据（截图+无障碍树），不要再猜坐标改自动化。

## 方案
仅在失败路径（`errorCode` 非空）捕获两样东西，随结果上报：

1. **截图**：`DeviceAccountScanService`（本身是 `Context`）构造 `ScreenCaptureService(ScreenCaptureReal.buildCaptureImpl(this) { MediaProjectionHolder.getOrCreateProjection(this) })`，调 `captureToBase64()`。未授权 MediaProjection 时返回 null，降级为无截图但仍正常上报（不阻塞）。
2. **无障碍树摘要**：新写 `fun dumpNodeTreeAsString(root, limit=80): String`，字段集仿 `DouyinCollectService.dumpNodeDescs`（className/viewIdResourceName/isClickable/bounds/text/contentDescription），BFS 遍历+节点数上限，返回多行字符串（不像 dumpNodeDescs 那样只打日志）。

数据流：
```
openSwitchAccountPanel/readAccountListFromPanel 失败
  → errorCode 非空
    → 尝试截图（失败/未授权 → null）+ 树摘要
      → sendScanResultBroadcast 新增 EXTRA_SCREENSHOT_B64/EXTRA_TREE_DUMP
        → AgentService.accountScanResultReceiver 读出
          → reportAccountScanResult/buildAccountScanResultBody 塞进 JSON body
            → POST /account-scan-result（服务端新增字段解构+落库 publish_tasks.response）
```

## 测试策略
- Android 单测：`dumpNodeTreeAsString` 纯逻辑（mock AccessibilityNodeInfo 树，断言输出含预期字段）；`buildAccountScanResultBody` 新参数后的 JSON 组装
- API 单测：`/account-scan-result` 新字段落库（mock db，断言 UPDATE 参数 JSON 含 screenshot_b64/tree_dump）
- 不需要真机 E2E（本次是纯诊断管道，功能验证靠下一次用户真机重试自然发生，不阻塞本 PR）

## 不包含
- 不改 `openSwitchAccountPanel`/`readAccountListFromPanel` 的坐标自动化逻辑本身（下一步，需等这次证据回来）
- 成功路径不产生截图/树摘要开销
