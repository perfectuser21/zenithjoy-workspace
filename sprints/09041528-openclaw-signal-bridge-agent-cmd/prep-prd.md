# 小改动 PrepPRD（偏大，路径 B）：OpenClaw 信号桥·件1 — agent-android 统一指令处理器

Brain task: `5b8d0139-f652-4fc9-a76e-a8aa4f4a7c6b`（已 claim: interactive-dev-skill）
决策依据: `7a4c0369`（OpenClaw 编排大脑 + com.zenithjoy.agent 设备执行端，supersede 0a6fd1d4）
GP 锚: `line02/keyword_acquisition`
系列: openclaw-signal-bridge（件1/3）；件2=中台桥端点，件3=phonectl CLI，另立任务

## 改什么

在 `services/agent-android` 新增**统一指令处理器**（CommandExecutor + 协议层），让中台（进而 OpenClaw）能经现有 WS 通道驱动手机执行动作原语并收到结构化回执。

指令集（8 个）：
| 指令 | 执行方式 | 成功判据（判定点，见登记表） |
|---|---|---|
| screenshot | 复用 sharedScreenCaptureService（撞锁 3×100ms 重试） | 拿到帧；错误码区分 NOT_AUTHORIZED/CAPTURE_BUSY/BLANK_OR_SECURE/NOT_INITIALIZED/NEED_USER_REAUTH；**结果必带 captureW/H + screenW/H**（720px 缩图 vs 物理坐标系错位是 AI 循环第一天就会撞的坑） |
| tap(x,y) | 新建带 GestureResultCallback 的手势封装 | onCompleted=成功 / onCancelled=GESTURE_CANCELLED / dispatch 返回 false=SERVICE_NOT_READY；坐标越界直接拒（COORD_OUT_OF_BOUNDS，防 Path 负界崩溃 0824 前科） |
| swipe(x1,y1,x2,y2,ms) | 同上 | 同上 |
| type(text) | 向当前焦点可编辑节点 SET_TEXT | 无焦点编辑节点→NO_FOCUSED_EDITABLE；**前台包不在白名单→REFUSED_PACKAGE** |
| key(back/home) | performGlobalAction | 返回值三态 |
| launch(pkg) | trampoline 拉起 + 前台包名轮询验证 | **前台真到目标包才算成功**（ColorOS 静默拦截/iAware 前科）；包不存在→PACKAGE_NOT_FOUND |
| device_info | 现有采集字段复用 | 总是成功 |
| tree_dump | UiTreeSnapshot 复用 | 结果显式带 truncated 标志+节点数 |

## 协议层（对抗审查修正：这是新建不是复用）

- WsClient 扩展：`onMessage` 透传 `msgId`；新增线程安全 `sendResult(inReplyTo, payload)`（现有 wsRef 是 private 纯下行）
- **correlation id 幂等**：同 msgId 重复到达返回缓存首次结果，不重放动作（heartbeat 重投递前科 dmSeenTaskIds）
- **有界队列 + 单消费协程**：入队立即返回，串行执行（天然互斥；不阻塞 okhttp reader 线程）；队列满→QUEUE_FULL
- WS 断线：在途指令生成 CONNECTION_LOST 终态，不静默丢

## 互斥（对抗审查修正：ScanMutex 布尔位不可用）

新建 **owner+租约原子锁**（AtomicReference CAS）：
- 指令会话持锁期间，DouyinCollectService / DouyinDmOutreachService / DeviceAccountScanService 三处任务入口统一先问锁，被锁则拒任务
- 每条指令续租；**租约 120s 无新指令自动释放**并上报 SESSION_EXPIRED（防 AI 循环中止后锁死原生流程——ScanMutex 永久 busy 事故前科）
- stale 复位只允许清自己 owner 的锁
- **heartbeat `busy` 字段接真实锁状态**（现在写死 false，中台会照常派单撞车）

## 安全（上线前硬红线）

- 删掉/脱敏 WsClient.kt:58 打印含 token 完整 URL 的日志（logcat 泄漏=整机可被冒充遥控）
- type/launch 目标包白名单：首版只放抖音系（com.ss.android.ugc.aweme 等）
- screenshot/tree_dump/type 受「远程协助」开关门控，关闭→REMOTE_CONTROL_DISABLED；**默认态=开（全部机型，Alex 2026-09-04 拍板）**，开关存在的意义是保留租户级关闭能力

## 不包含

- 中台桥端点（件2）、phonectl CLI（件3）
- OpenClaw 侧 skill/SOP
- 客户机灰度（先机队单机：截屏授权只在小黄或小粉先验）
- 红线动作业务闸（私信/关注/点赞频控在中台桥做，件2）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| tap/swipe 成功 | ①dispatch 提交即成功 ②GestureResultCallback 三态 | ② | 全仓 9 处现有用法都是①，会把 GESTURE_CANCELLED 谎报成功 | AI 基于假成功继续推理，流程错乱 |
| launch 成功 | ①startActivity 不抛异常 ②前台包名轮询到位 | ② | ColorOS 静默拦截不抛异常（真机实锤注释） | 谎报成功，后续指令全打在错误 app 上 |
| screenshot 失败分类 | ①统一 null ②错误码区分永久/瞬时 | ② | MediaProjection REVOKED 后恒 null，AI 会无限重试 | 永久性故障被当瞬时，重试风暴 |
| 截图↔点击坐标系 | ①AI 直接用截图像素坐标 ②结果带双分辨率由上游换算 | ② | 截图缩到 720px，物理屏 1080+ | 全部点击系统性偏移 |

## 验收标准

- [ ] commit-1：failing test 先行（协议解析/互斥锁/坐标校验/幂等去重单测 + smoke 脚本）
- [ ] commit-2：实现转绿
- [ ] smoke: `.github/workflows/scripts/smoke/agent-cmd-executor-smoke.sh` 进 CI
- [ ] 守卫 proven-to-fire：互斥锁被占时任务入口拒单的测试，亲眼见红一次
- [ ] CI 全绿；PR 声明 GP 锚 keyword_acquisition
