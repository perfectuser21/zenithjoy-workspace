# 小改动 PrepPRD：安卓 agent 加 debug-only E2E 触发器

## 改什么
在 `services/agent-android/app/src/debug/` 新增一个 debug 专属源集：
- `kotlin/com/zenithjoy/agent/debug/DebugE2ETriggerReceiver.kt`：exported BroadcastReceiver，收到 `com.zenithjoy.agent.DEBUG_E2E` 广播后，按 `flow` 参数（collect/dm/scan）在应用内转调对应服务的静态 `dispatchTask`。
- `AndroidManifest.xml`（debug 源集）：声明该 receiver exported=true，仅合并进 debug 变体。

## 为什么改
生产链路里 collect/dm_outreach/account_scan 三个内部接收器都是 `RECEIVER_NOT_EXPORTED`（防外部伪造任务），任务只从中台服务器轮询。这在生产正确，但真机端到端验证没有 adb 可驱动入口——设备 agent 未配 license 时整条链无法手动跑起来演示。此 receiver 只编进 debug 包，release 包不含，安全。

## 关联上下文
- Journey：Line02 客户智能获客路径（抖音搜索→抓评论→定位主页→关注点赞热身→私信）
- 相关代码：DouyinCollectService / DouyinDmOutreachService / DeviceAccountScanService 的 dispatchTask
- 历史决策匹配：无

## 影响范围
- 仅 debug 变体。release 包不包含 `src/debug` 源集，生产行为零改动。
- receiver 只转调既有静态方法，不新增业务逻辑。

## 验收标准
- [ ] debug 包能被 adb 广播 `DEBUG_E2E` 触发三条 flow，release 包不含该 receiver（构建产物验证）
- [ ] 单测：DebugE2ETriggerReceiver 按 flow 正确路由到对应 dispatch（错误 flow 不崩）
- [ ] CI 全绿
