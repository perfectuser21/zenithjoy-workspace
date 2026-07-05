# PrepPRD：客户私域 AI 接管 — 桌面租约仲裁层(Desktop Arbiter)第一刀

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：Arbiter TS 本体(acquire/renew/release/yield 协议 + 优先级抢占 + TTL 看门狗，内存 Map 存储)+ module-manager 挂载点 + 微信 listen_chat 最小让位接入(循环顶加守卫，不重构主循环)+ module-manager 收费站绕过检测(只记日志，不拦截)
- [ ] 另立 Sprint（本次不做）：module-manager 进程树硬管控+单实例锁（堵住子孙进程绕过收费站的漏洞本体）、抖音获客/发布器等其他 agent 接入仲裁协议、多微信号并发锁粒度细化（业务事实未确认，见下）

## Journey 当前状态
- ✅ 中台 AI-native CRM·客户列表页 — mature/done
- 🔄 微信客服 窗口可见+不抢焦点+真送达验证 — medium/working（本次仲裁层是它的稳定性使能件）
- ⬜ 桌面租约仲裁层(Desktop Arbiter) — 本次新建 thin

## 本次要做的
一台 Windows 机器上同时跑多个 line agent（微信客服常驻低优 + 未来的抖音获客/发布器一次性高优）会互相抢前台窗口焦点/键鼠，互相打断甚至把对方操作搞崩。做一个通用的"桌面租约仲裁层"：谁想操作前台先申请租约，用完释放，高优可以请求低优"优雅让位"（绝不强杀），持锁方超时不续租自动被收回防死锁。第一刀先把机制做通用、做对，只接微信 listen_chat 一个客户端验证闭环。

GitHub 调研已完成（无编造，均已核实真实存在）：无现成方案可直接拿来用，参考三个真实项目的设计片段自研——`proper-lockfile`(TTL+心跳续租机制) + `ROS actionlib`(pending→active→preempting→preempted 抢占状态机语义) + UiPath Orchestrator 文档("run only one job"+优先级排队语义，闭源仅供设计参考)。已满足"native-first"铁律的豁免条件（先查证无框架能力可用，才允许手搓）。

## Golden Path

1. 中台派发一次性高优任务 → module-manager 调用 `acquire(requester={id, kind, priority})` → 若队列已有其他请求，按 `(priority desc, 到达时间 FIFO)` 排队，同优先级不插队
2. Arbiter 检查当前持有者（**第一刀锁粒度 = 整机一把锁，不分微信号**——多号并发能否安全后台并行尚未真机验证，先按最保守假设整机串行）→ 向持有者（微信 listen_chat）发**软让位信号**（写让位控制文件，原子写：临时文件+rename，防止读到写半截的内容）
3. 微信 listen_chat 循环顶部检测到让位信号 → 做完当前这一条原子操作（比如正在发的这条回复）→ `release`（**release 必须放在 finally/统一收尾路径**，不管发送成功/异常都执行，避免业务异常打断让位流程导致永久卡在"收到信号未释放"状态）→ 进入静默等待
4. 若宽限期（35s）到仍未 release（正卡在不可中断的 UIA 调用中）→ Arbiter **不 kill 微信、不重启微信**，将其租约标记 `strip`（失效）并把租约授予高优任务；原持有者事后自查发现租约已失效 → 自行归位，不再继续操作前台（不裸奔）
5. Arbiter 把租约授予高优任务，module-manager 放行该 line 进程操作前台
6. 高优任务完成（或异常/进程崩溃未主动 release）→ 统一走 TTL 看门狗回收（持有方每 10s 续租一次，连续 2 次漏心跳 > 90s TTL 才判定死亡收回，避免系统负载抖动误杀）
7. Arbiter 检测到租约空闲 → 微信 listen_chat 恢复工作走**重新 acquire 排队**（不享受"断点续锁"特权，若此时又有新高优到达，可能再次让位，属设计预期）
8. module-manager 崩溃重启 → Arbiter 租约状态在内存（进程内 Map），**重启 = 租约全归零 = 天然安全默认值**（不会有僵尸持锁跨重启存活）；下一个 acquire 从空闲状态重新竞争

补充失败路径：
- 两个高优几乎同时 acquire → module-manager 单进程 Node 事件循环天然串行，acquire 判定与状态写入在同一个不可分割的同步代码块内完成，第一刀写单测覆盖"并发 acquire 只有一个成功"
- module-manager 收费站已知漏洞（子/孙进程绕过它直接操作前台，历史上出现过孤儿 listener 抢微信跑满 24h）→ 第一刀**只做检测不拦截**：Arbiter 每次 acquire/renew 时对比"当前前台窗口/活跃进程"与"租约记录中合法 holder"是否一致，不一致记异常日志+告警，为后续独立 sprint 补进程树管控攒证据，不阻塞本次锁本体上线

## 客户视角
最终客户看不到这层机制本身，但会感知到：微信客服回复不再被莫名打断/变卡/偶发抢焦点闪屏，未来抖音获客等新能力上线后也不会把正在接待客户的微信搞崩。

## 完成后用户能
- 中台派发高优任务时，微信客服会优雅让出前台（做完手头这条回复），不被强杀、不丢会话状态
- 高优任务做完后微信客服自动恢复接待，全程无需人工干预
- 任何一方卡死/崩溃，看门狗自动回收租约，不会永久卡死整机

## 涉及的 Ability / Feature
- 桌面租约仲裁层(Desktop Arbiter)（新建 thin，feature_id: 8358dd63-c0fe-4942-a2f5-d9b5d7c9e3bb）
- 微信客服 窗口可见+不抢焦点+真送达验证（间接受益，不改动其厚度）

## 不包含
- module-manager 进程树硬管控/单实例锁（收费站漏洞本体修复，另立 sprint）
- 抖音获客/发布器等其他 agent 接入仲裁协议（横向铺开阶段，另立 sprint）
- 多微信号并发锁粒度细化（业务事实未确认，需真机验证后再定）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 微信客服真机测试号 — xian-rog 机器已有登录会话，复用现有 Line04 真机验证环境

### API 与凭据
- [x] 本次无新增外部 API/凭据依赖，纯内部 TS(module-manager) + Python(listen_chat) 进程间协调

### E2E 测试账号
- [x] 复用现有微信客服真机验证账号（xian-rog，Line04 既有真机验证流程）

### 测试 Fixture
- [x] 无需新增素材，用真实客户消息触发 listen_chat 回复周期即可验证

### 基础设施
- [x] xian-rog（windows_wechat 真机，self-hosted runner）已就绪
- [x] module-manager 现有 HTTP server 已就绪，可直接挂载 `/internal/arbiter/status` 端点

## 验收标准（Final E2E，真机 xian-rog，防假成功——不信日志，走"送达读回验证法"）
- [ ] 微信 listen_chat 常驻运行中，模拟真实客户消息触发其进入"正在回复"周期
- [ ] 在其 UIA 发送/校验窗口期内，module-manager 派发高优 oneshot 任务，验证 `acquire` 返回 `queued` 而非直接抢断
- [ ] 微信完成当前这条消息发送（用现有"读回验证"方法确认真送达，不信日志）后 `release` 发生，高优任务随即拿到 `granted`
- [ ] 高优任务跑完 `release` 后，`GET /internal/arbiter/status` 确认 queue 清空、holder 归位
- [ ] 微信 listen_chat 进程全程未被 kill/重启（PID 前后一致），UIA 树未塌（能立即扫描到下一条新消息，无需人工重启微信）
- [ ] 异常分支：故意让高优任务不发 renew（模拟卡死）→ 验证 TTL 90s(2次漏心跳)后自动回收，日志/告警触发
- [ ] TS 单测覆盖：租约/抢占/看门狗/并发 acquire 唯一成功
- [ ] CI 全绿
