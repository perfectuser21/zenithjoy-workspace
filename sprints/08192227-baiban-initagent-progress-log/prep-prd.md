# Bug PrepPRD：小白拉到任务却不干活 —— 三层根因

task-id: fdd51a8b-a421-4459-b96e-7727fe5fc39e
GP-Anchor: line02/keyword_acquisition keep-green
decisions: 44cb3e8e（真根因）/ 750c1a9d（判定点）/ b303796e（首个被证伪的假设，留档）

## 症状
小白 realme RMX3478（agent 2.1.28）心跳正常、WS 正常，但采集任务拿到后毫无动作：
中台看到任务被拉走标 running → 10 分钟后被 sweep-timeouts 收成 failed → videos=0。
2026-08-19 当天 12 个任务全是这个形状。

## 先证伪：交接单的「initAgent 协程挂起」不成立
交接单据「按 pid 抓全量 logcat 只有 WebSocket 活动 / 没有 agent started 这行」推断
initAgent 挂在 heartbeatLoop 与 collectPollLoop 之间。三个真机探针实验（往库里塞任务、
全程不碰轮询接口）证伪：

| 探针 | 结果 |
|---|---|
| 14:32:57 建 | 31 秒后被小白拉走标 running |
| 14:35:53 建 | 14 秒后拉走，logcat 实录到完整轮询链 |
| 重启进程后 14:40:05 建 | **3 毫秒内派发** |

轮询一直正常，`config.agentId` 不为空，initAgent 早就跑完（collectPollLoop.start() 就在其末尾）。
静态分析也印证：该区间全是同步构造代码，没有任何挂起点，协程不可能在那里挂起。

## 真根因（三层）

### ① 无障碍授权落在 .e2e 变体包上，干活的 prod 包一条没有
```
Enabled services:{ com.zenithjoy.agent.e2e/...DouyinCollectService,
                   com.zenithjoy.agent.e2e/...DouyinDmOutreachService,
                   com.zenithjoy.agent.e2e/...DeviceAccountScanService }
真正在跑/拉任务/心跳的进程: com.zenithjoy.agent (prod 2.1.28, pid 7205)
另一个也在跑:              com.zenithjoy.agent.e2e (2.1.24-e2e, pid 10809)
```
prod 包的 DouyinCollectService 未绑定 → 派发广播进虚空 → 实录到每 30 秒重试一次、永不 ack。
旧自检 `collectServiceEnabled()` 比的是 Secure Settings 字符串里有没有 "DouyinCollectService"
—— 字符串里确实有，只是包名前缀是 .e2e。**既不看包名也不看 Bound，双重撒谎**。
`AgentService.REQUIRED_ACCESSIBILITY_SERVICES` 更糟：硬编码 prod 包名 + 用短格式
`pkg/.collect.Xxx` 与真机的全限定格式做精确字符串比较 → **恒报缺失（恒假红）**，长期被当噪音无视。

### ② 队列僵尸死锁（结构性，全机队都会中）
`processNextQueuedTask()` 两个 return 全静默；`currentJob` 只有 4 条清除路径，全部依赖
DouyinCollectService 回调；而 ack 看门狗在 `currentAccepted == true` 之后**主动放弃**
（`if (... || currentAccepted) return@launch`）。「接了但没跑完」因此落进完全没人管的真空区：
currentJob 永久挂着，此后所有任务只入队不派发、全程零日志。

### ③ okhttp debug 刷屏（让前两层查不出来的元凶）
两台真机 ROM 都设了 `persist.log.tag=V` → okhttp 4.12 的 `isLoggable(FINE)` 恒真。
实测按 pid 抓小白日志 **302 行里 286 行是 okhttp 噪音（95%）**，agent 日志活不过 1 分钟
就被冲出环形缓冲区。交接单那个「只有 WebSocket 活动」的观察就是这么来的。

## 修法（一个 PR，用户 2026-08-19 拍板"一个 PR 全做"）
1. `AccessibilityGuide`：改用 `AccessibilityManager.getEnabledAccessibilityServiceList()`
   取**真 Bound** 列表，按 `ServiceInfo.packageName/name` 与**本进程 context.packageName**
   严格比对；缺失时点名"这个服务被哪个包拿走了"。删除被取代的字符串判据。
2. `CollectTaskQueue.reclaimStaleCurrent()`：僵尸 currentJob 超时强制回收，
   **不看 currentAccepted**（accept 之后才是真空区）。阈值 480s：> ack 看门狗最长
   重试窗口 300s（防误杀），< 服务端 sweep 的 600s（保证设备赶在中台收尸前诚实上报）。
   回收后主动上报 `AGENT_QUEUE_STALLED`（服务端白名单同步新增，否则被压成 UNKNOWN）。
3. `processNextQueuedTask` 两个静默 return 全部留痕。
4. `OkHttpDebugLogSilencer`：把 okhttp 内部 logger 显式设 `Level.OFF`，在
   `AgentApplication.onCreate` 最先执行；持强引用防 GC 后 level 复位。

## 不包含（下一刀）
- `pending-collect-tasks` 的 `WHERE agent_id=$1 OR id::text=$1 LIMIT 1`（无排序）消歧
  —— 已确认原样还在 main，staging 库现存 3 对交叉污染行、每对横跨两个租户。
- 心跳上报 init_stage / 中台按 init_stage 判可派单（判定点 750c1a9d 记为下一刀）。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 本进程的无障碍服务是否真的可用 | ①Secure Settings 字符串含类名 ②`getEnabledAccessibilityServiceList()` + 包名严格比对 ③dumpsys 文本解析 | ② | ①在 ColorOS 上 Enabled≠Bound、且不看包名（.e2e 与 prod 互不相通）；③需要 shell 权限 | 自检显示"✅已开启"但服务根本没绑，采集/私信/扫描全部静默失效，排查烧掉整天 |
| ⚠️ 设备是否真的启动完成 | ①last_heartbeat_at ②logcat `agent started` ③心跳上报 init_stage | ②（本刀）；③留待下一刀 | 用户拍板先只加日志、不动心跳协议，避免旧版本 agent 上报空值被误判成不可用 | 把没跑完的设备当健康设备派单 → 任务标 running 后无人执行 → 静默吞任务永久卡死 |

## 验收标准
- [x] commit-1 失败测试先提交（RED：服务端 3 个测试实跑失败，安卓 4 个测试类编译不过）
- [x] commit-2 实现让测试变绿（安卓 90 类 550 用例 0 失败；服务端 acquisition 100 用例通过）
- [x] proven-to-fire：注入 4 处变异，4 个测试类各自报红后还原复绿
- [ ] CI 全绿
- [ ] 出包装小白真机复验（需先人工把无障碍授权给 prod 包、停用 .e2e 包）
