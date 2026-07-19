# 设计：账号扫描补手动触发通道

## 背景

真机测试发现：`DeviceAccountScanService`（读抖音"切换账号"面板，检测客户绑定的小号）唯一触发路径是 `AgentService.runAccountScanLoop` 里 `Random.nextLong(30分钟, 60分钟)` 的被动定时器。WS 协议对比 `collect_task`/`dm_outreach` 都有服务端主动推送分支，账号扫描没有——客户切完抖音账号后 Dashboard 长时间不显示，最长可能要等一小时，且中途无反馈。

DM 私信派单同样走"服务端建 publish_task → ws1 心跳(30s周期)拉取"这套机制，今天真机验证过 60-90 秒可用。本次照抄同款机制，不改造更重的 ws0 真 WebSocket（用户已在拍板点确认接受"最坏约30秒"而非精确3-5秒的延迟）。

## 方案

三处联动：

1. **API**：新增 `POST /api/agent/account-scan/trigger`，查在线 android agent（`capabilities @> '{android}'` 且 2 分钟内有心跳）→ 无则 400 明确拒绝；有则 `INSERT publish_tasks(..., task_type='account_scan', ...)`。60 秒内同 agent 重复触发 → 限流 400。
2. **Android**：`AgentService.kt` heartbeatLoop 的 `onTask` 回调新增 `shouldRouteAccountScan` 判别符分支，命中调用既有 `DeviceAccountScanService.dispatchTask(...)`。不需要新增去重逻辑——`DeviceAccountScanService` 已有 `state != State.IDLE` 早退判断，手动触发和内部循环触发天然互斥。
3. **Dashboard**：`AcquisitionAccountsPage.tsx` Android 绑定区加"立即扫描"按钮，点击后调用触发端点，成功提示"已发送，最长等待约30秒"，60秒内本地禁用防连点；设备离线时 Toast 明确提示。

## 数据流

```
Dashboard点"立即扫描"
  → POST /api/agent/account-scan/trigger（校验在线设备+限流）
    → INSERT publish_tasks(task_type='account_scan')
      → 手机端 ws1 心跳（≤30s周期）拉到这条task
        → AgentService.onTask 命中 shouldRouteAccountScan
          → DeviceAccountScanService.dispatchTask（若非IDLE则静默跳过，天然防重叠）
            → 扫描完成 → 沿用既有 account-scan-result 上报路径 → Dashboard刷新可见
```

## 测试策略

- **API 单测**：无在线设备→400；有在线设备→200+publish_tasks新增一行；60秒内重复→限流400
- **Android 单测**（`AgentServiceAccountScanTest.kt` 追加）：`shouldRouteAccountScan`判别符测试；WS收到`task_type=account_scan`时调用`dispatchTask`（mock验证调用，同warmup/dm_outreach现有测试模式）
- **Dashboard E2E**：Playwright stub后端响应，验证按钮点击→60秒本地禁用→离线态提示（同PR #1408已建立的真Playwright规格模式）
- 不需要integration/真机E2E：扫描本体逻辑未改动，本次只加一个外部触发入口，末端行为已被既有测试覆盖

## 不包含

- 不改 `runAccountScanLoop` 内部30-60分钟被动轮询本身（继续保留兜底）
- 不改 `DeviceAccountScanService` 扫描本体逻辑（面板读取/账号识别/结果上报）
- 不改造ws0真WebSocket通道（另立sprint的范围，本次不做）
