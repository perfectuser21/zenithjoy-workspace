# 设计：OpenClaw 信号桥·件1 — agent-android 统一指令处理器

日期：2026-09-04 ｜ Brain task `5b8d0139` ｜ 决策 `7a4c0369`（supersede `0a6fd1d4`）
GP 锚：`line02/keyword_acquisition keep-green` ｜ sprint: `sprints/09041528-openclaw-signal-bridge-agent-cmd`
PrepPRD（含判定点登记表与对抗审查修正）：`sprints/09041528-openclaw-signal-bridge-agent-cmd/prep-prd.md`

## 目标

让中台（进而 OpenClaw AI 循环）能经现有 WS 通道驱动手机执行 8 个动作原语并收到可区分错误码的结构化回执。件1 只做设备端；中台桥（件2）、phonectl CLI（件3）另立任务。

## 组件划分（新增 `com.zenithjoy.agent.command` 包）

| 组件 | 职责 | 依赖 | 可测性 |
|---|---|---|---|
| `CommandProtocol` | 指令/回执消息的解析与序列化；坐标校验（越界→COORD_OUT_OF_BOUNDS） | 无（纯逻辑） | JVM 单测 |
| `CommandQueue` | 有界队列（容量 8）+ 单消费协程串行执行；correlation-id LRU 去重（同 id 返回缓存首次结果）；队列满→QUEUE_FULL | 协程 | JVM 单测 |
| `AutomationLease` | owner+租约原子锁（AtomicReference CAS）；每指令续租，120s 无指令自动过期→SESSION_EXPIRED；只允许 owner 自清 | 无 | JVM 单测 |
| `CommandExecutor` | 指令分发到各原语执行器；统一 try/catch 转结构化错误；每回执带前台包名 | 下述执行器 | JVM 单测（执行器可注入 fake） |
| `GestureRunner` | tap/swipe 封装：GestureResultCallback 三态（onCompleted=OK / onCancelled=GESTURE_CANCELLED / dispatch false=SERVICE_NOT_READY） | 无障碍服务实例 | 接口抽象后单测判定逻辑 |
| `LaunchRunner` | trampoline 拉起 + 前台包名轮询验证（成功=目标包真到前台）；PackageManager 预查→PACKAGE_NOT_FOUND | AgentService 现有 trampoline | 判定逻辑单测 |
| `ScreenshotRunner` | 复用 `sharedScreenCaptureService`，撞锁 3×100ms 重试；错误码 NOT_AUTHORIZED / CAPTURE_BUSY / BLANK_OR_SECURE / NOT_INITIALIZED / NEED_USER_REAUTH；**回执必带 captureW/H + screenW/H** | ScreenCaptureService | 错误分类逻辑单测 |
| `TypeRunner` | 向当前焦点可编辑节点 SET_TEXT；无焦点→NO_FOCUSED_EDITABLE；前台包不在白名单→REFUSED_PACKAGE | 无障碍服务 | 判定逻辑单测 |

## 既有代码改动（三处，全部最小侵入）

1. **WsClient**：`onMessage` 回调透传 `msgId`；新增线程安全 `sendResult(inReplyTo, payload)`（复用 makeMsg）；`onFailure/onClosed` 时对在途指令生成 CONNECTION_LOST 终态；**删除 line 58 打印含 token URL 的日志（脱敏为 host 级）**
2. **AgentService**：注册 `cmd` 消息类型→入 CommandQueue；heartbeat `busy` 字段从写死 false 改为读 AutomationLease + 原生任务状态
3. **三个原生服务任务入口**（DouyinCollectService / DouyinDmOutreachService / DeviceAccountScanService）：接任务前先问 AutomationLease，被指令会话持锁则拒单（回执 DEVICE_BUSY_REMOTE）；stale 复位只清自己 owner 的锁

## 安全

- 远程协助开关 `remoteControlEnabled` **默认开**（Alex 2026-09-04 拍板，全部机型）；关闭→REMOTE_CONTROL_DISABLED。保留租户级关闭能力
- type/launch 目标包白名单首版只放抖音系（`com.ss.android.ugc.aweme` + aweme_hotsoon 变体）
- token 日志脱敏（见 WsClient 改动 1）

## 数据流

```
中台 WS 下发 {type:"cmd", msgId, payload:{action, args...}}
  → WsClient.onMessage(type, payload, msgId)
  → AgentService 路由 → CommandQueue.enqueue（去重/满拒）
  → 单消费协程：AutomationLease.renew → CommandExecutor.execute(action)
  → 结果 {inReplyTo: msgId, ok, errorCode?, foregroundPkg, data?}
  → WsClient.sendResult
```

## 错误处理总则

- 一切异常必须转结构化错误码回传，绝不崩无障碍服务（0824 Path 负界崩溃前科）
- 错误码分永久（NEED_USER_REAUTH / PACKAGE_NOT_FOUND / REFUSED_PACKAGE）与瞬时（CAPTURE_BUSY / GESTURE_CANCELLED / QUEUE_FULL），上游据此决定是否重试
- WS 断线在途指令→CONNECTION_LOST 终态，不静默丢

## 测试策略（四档）

- **Unit（JVM，主力）**：CommandProtocol 解析/坐标校验、CommandQueue 去重/满拒/串行、AutomationLease CAS/续租/过期/owner 自清、GestureRunner 三态判定、ScreenshotRunner 错误分类、TypeRunner 白名单判定——沿用仓库现有 `*LogicTest.kt` 纯 JVM 模式
- **Integration**：三个原生服务入口的拒单行为（lease 被持时任务被拒）——**此测试兼守卫，必须先见红一次（proven-to-fire）**
- **E2E/smoke（CI）**：`.github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh`——gradle 跑 command 包全部测试 + grep 断言接线点存在（AgentService 注册 cmd 类型、heartbeat busy 非硬编码 false、WsClient 无 token 明文日志）
- **真机 E2E（CI 外，件2 后）**：机队单机（小黄或小粉）下发真实 tap→回执验证；截屏授权单机先验，不碰全机队

## 不做（YAGNI）

- 不做指令级频控/红线业务闸（件2 中台桥职责）
- 不做 tree_dump 双抓取选优（现有 UiTreeSnapshot 直接复用，回执带 truncated 标志即可）
- 不做推流帧缓存复用优化（撞锁重试已够，量化数据出来再说）

## Research 审查修正笔记（实现计划必须按此，不按设计正文的近似说法）

1. launch 直接调 `account/DouyinLaunchTrampoline.buildTrampolineIntentForTarget(context, intent)`（object），AgentService.kt:532 只是调用方之一
2. WsClient 回调唯一构造点在 AgentService.kt:386-392，`cmd` 路由插这里；改签名同步该 lambda
3. lease 拒单覆盖 **5 处入口**：DouyinCollectService.startCollect(:204)/startStage2Collect(:252)、DouyinDmOutreachService.startOutreach(:172)、DeviceAccountScanService.startScan(:131)/startWarmup(:833)；另 shouldRunScan(:1162) 内部检查点也问 lease
4. busy 字段只在 WS 心跳存在；中台实际派单走 HttpHeartbeatLoop（无 busy）——**防撞车的真保障是入口拒单，busy 仅观测信号**
5. sendResult 锚在 wsRef(AtomicReference) null 检查上走 CONNECTION_LOST
6. smoke 照抄 douyin-dm-outreach-android-smoke.sh（gradle --tests + XML 断言）+ account-scan-trigger-smoke.sh（grep 接线）；command 包单测经 android-agent-ci.yml 自动进 CI，无需额外接线
7. 测试抽象照 uia/NodeAwaitTest.kt 先例（依赖收进注入 lambda，判定逻辑纯函数化）

## commit 纪律

E2E-first 两段式：commit-1 = 全部 failing tests + smoke 脚本；commit-2 = 实现转绿。
