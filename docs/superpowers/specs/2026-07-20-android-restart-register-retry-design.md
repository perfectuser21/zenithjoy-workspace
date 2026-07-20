# 设计：Android Agent "重启服务"按钮无法重试注册

## 问题

`AgentService.onStartCommand` 用 `agentInitialized`（一次性标志位）整体守护 `initAgent()`。
`register()` 调用嵌套在 `initAgent()` 内部，被 `if (!config.isRegistered)` 二次保护。
一旦 Service 首次 `onStartCommand` 跑过一次（无论 register 成功与否），`agentInitialized`
永久为 `true`，之后任何 `onStartCommand`（包括"重启 Agent 服务"按钮触发的
`startForegroundService()`）都不会再进 `initAgent()`，`register()` 也就永远不会重试。

真机复现：staging License 配额从 1 提到 2（修复了 register 失败的服务端原因）后，用户点击
"重启 Agent 服务"按钮，10 分钟窗口内服务器日志（`/api/agent/register` 与 ws hello）无任何新请求。

## 方案

把"重试注册"从"只跑一次的循环初始化"里解耦：

1. 从 `initAgent()` 抽出注册逻辑为独立的 `private suspend fun performRegister()`
   （首次注册行为不变，只是改为被调用）。
2. 新增 `@Volatile private var registerRetryInFlight = false` 防并发重复调用。
3. 新增纯函数：
   ```kotlin
   internal fun shouldRetryRegister(isRegistered: Boolean, retryInFlight: Boolean): Boolean =
       !isRegistered && !retryInFlight
   ```
   对齐仓库既有 `shouldRunInitAgent`/`shouldRouteAccountScan` 纯函数 + 伴生对象测试模式
   （Kotlin 测试环境无 Robolectric/Mockito，测不了真实 Service 生命周期，只能测决策逻辑）。
4. `onStartCommand`：`shouldRunInitAgent` 为真时走原逻辑不变；为假时若
   `shouldRetryRegister(config.isRegistered, registerRetryInFlight)` 为真，
   `launch { registerRetryInFlight = true; try { performRegister() } finally { registerRetryInFlight = false } }`。

不需要给 Intent 加特殊 extra 区分"用户点的按钮"——任何一次 `onStartCommand` 交付
（按钮点击或系统重启 Service）在未注册状态下都会自然重试，按钮天然生效，Service 被系统
重建后也能自愈。

不改动 WsClient/HeartbeatLoop：已用 license key 兜底连上（真机日志已验证），注册成功只是
补齐状态页展示和 `config.wsToken`，不需要重连。改动面最小，不触碰已经工作的连接。

## 测试策略

单元测试覆盖 `shouldRetryRegister` 的 4 种组合（已注册/未注册 × 有无并发重试中）。
核心回归断言：`shouldRetryRegister(isRegistered = false, retryInFlight = false)` 必须为
`true`（当前代码没有这条路径，测试先红后绿）。集成测试覆盖真实 Service 生命周期在此仓库
不可行（已知约束），沿用既有纯函数验证模式即为该类改动的验收上限。

## 不做的事

- 不改 WsClient 重连逻辑
- 不给 Intent 加新 extra
- 不改 initAgent 里除注册外的其它初始化顺序
