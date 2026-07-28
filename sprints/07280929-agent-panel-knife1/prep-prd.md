# PrepPRD：Path4「客户私域 AI 接管」— 作战窗 Agent Panel 刀1

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：事件总线+看门狗+line04真实打点+WebView2桌面壳(三态)+中台events表+薄写入端点+首次装机仪式
- [ ] 另立 Sprint（本次不做）：中台聚合SSE+dashboard「实时动态」页（刀2）、客户视图脱敏分级+画像卡合流（刀3）
- [ ] 待讨论：apps/dashboard 若客户也会看到「实时动态」页，需要按角色分视图——留给刀2的PrepPRD明确

## Journey 当前状态（Path4，摘选相关项）
- ✅ 客服层多租户隔离 — medium/working
- ✅ 消息/动态采集通道、后台静默发送通道、接管开关 — thin/working
- 🔄 桌面租约仲裁层(Desktop Arbiter/desktop-lease-broker) — thin/building（本sprint直接复用其现有TS模块 `services/agent/src/desktop-lease-broker.ts`）
- 🔄 AI 思考浮窗(画像卡) — thin/building（本sprint**不碰**，只需保证不共用同一events.jsonl文件）
- ➕ 作战窗 Agent Panel 刀1 — 本次新建，thin（feature_id=8a407a8a-e6b9-46e1-93f5-b8b448707e25）

## 本次要做的
客户装的 Agent 之外，新增一个常驻桌面壳（WebView2），让客户和运营者第一次能"看见" AI 在替他们干活——不是死气沉沉的托盘图标，是会变色、会展开看进度的活的东西。首次连上中台成功时主动展开一次亮相，往后收起为常驻边缘灯带。

## Golden Path

1. **首次装机仪式**：客户完成扫码绑微信、装客户端后，Agent 首次真正连上中台成功那一刻 → 面板不等召唤，自动全屏展开一次，播放上线文案（"作战窗已上线 · 从现在起你能随时看到 AI 在做什么"）+ 活跃波形动画 + 热键提示 → 停留数秒或客户操作后自动收起为常驻边缘灯带（本地记一次性标记位，只触发一次，往后不再自动弹出）。不加 Windows 系统级 toast 通知双保险。
2. 收起态：屏幕边缘细灯带常驻，只有真实接入的 line04 会上灯（其余线"未接入"占位只在展开态显示，不上灯带，避免稀释信号）
3. 客户按热键(Ctrl+Alt+Z)或点托盘 → 展开为全屏Warroom看板（默认场景），三条业务线横向泳道，标题用业务语言（智能获客/智能回复/智能发布），**不出现line02/line04代号**
4. 单业务线可并发多task；灯态=该线所有并发task中最高优先级状态的max()：stuck(红)>waiting(黄)>干活中(黄)>完成/空闲(绿/灰)
5. task生命周期：task_started(灯变绿,新增卡片)→step(原地刷新卡内文案,不新增卡片)→waiting(灯变黄,"等待中:xxx")→done(灯闪绿后回灰,卡片打勾进"最近完成")或failed(灯变红,卡片标红+失败原因,同样进"最近完成")
6. 看门狗：单task 90秒无后续step事件→判定stuck，灯变红，文案"处理时间较长，正在自动恢复"，只读无任何操作按钮；stuck是过渡态非终态，等真实done/failed替换或客户联系人工
7. 客户在自己电脑跑微信/抖音RPA时：面板检测desktop-lease-broker租约，判定RPA进行中→即使客户展开面板，也不给全屏，自动退让对角贴边小窗+只读+鼠标穿透(WS_EX_TRANSPARENT)+永不夺焦(WS_EX_NOACTIVATE)；若客户正展开着全屏面板期间RPA突然开始，立即抢占式收起为贴边态，不等客户手动收起
8. desktop-lease-broker本身查询失败/超时：**fail-closed**，默认当作RPA进行中，保持贴边穿透，绝不擅自全屏
9. 客户前台全屏(视频/PPT/游戏)：浮条自动隐藏；stuck例外——不弹窗不闪烁，只让托盘图标变红
10. 网络/进程异常：面板↔Agent本地SSE断开(无论Agent崩溃重启还是网络问题)，统一进客户可见的"离线/重连中"灰态；重连后从Agent本地内存拉取当前活跃task最新快照直接覆盖UI(不经中台，不重放历史事件流)；重连成功后对期间产生的done/failed事件一次性弹出摘要（"离线期间完成2个任务，失败1个"）
11. 中台写入失败：本地缓存+指数退避重试3次，仍失败落本地结构化日志(接入现有日志采集链路)，UI不阻塞不提示
12. WebView2 Runtime缺失：不用WebView2渲染提示(避免自举悖论)，改用Win32原生MessageBox弹一行文字+"打开下载页"按钮

## 客户视角
装完 Agent 后，屏幕边缘出现一次全屏亮相，告诉客户"作战窗已上线"，然后缩成一条会变色的细线——绿的时候说明 AI 正在忙，按个快捷键能展开看到"AI 正在帮我回复客户张三，第2步/共5步"，事情做完了列表里会多一条记录。AI 用微信自动聊天的时候这条面板会自动让到角落，不会挡着看真实聊天记录。

## 完成后用户能
1. 装机完成的第一时间就知道"作战窗已上线"，不用自己发现
2. 一眼看出 AI 是在干活、空闲、还是卡住了，不用问运营
3. 展开看到具体在处理谁、第几步
4. AI 卡住时能第一时间感知到（红灯），而不是等客户投诉才发现

## 涉及的 Ability / Feature
- 作战窗 Agent Panel 刀1（新增，thin，feature_id=8a407a8a-e6b9-46e1-93f5-b8b448707e25）

## 不包含
- 中台聚合SSE推送+dashboard「实时动态」页面（刀2）
- 客户视图脱敏分级(隐藏设备序列号/task_id等技术细节)、画像卡合并进新壳（刀3）
- 真正的"AI在想什么"思考级流式展示（本刀只做活跃波形+滚动小日志等前端表现层技巧）
- 多设备/多抖音小号矩阵接入（schema带device/os_type字段但UI暂不需要真泳道）
- WebView2 Bootstrapper自动补装状态机（只做检测+提示手动下载）
- Agent心跳新增event_bus_alive字段（跨系统影响面，独立评估）
- 多task_id独立看门狗+分类型超时阈值（灯态聚合已解决展示层需求，不需要逐task监控UI）
- stuck卡片自动超时清理、失败重试耗尽后的自动对账/告警（刀1只留证日志，人工事后排查）
- Windows系统级toast通知（面板全屏展开本身已足够醒目）

## 判定点登记表（已写入 decisions 表，10条，category=judgment）
| 判定点 | 所选方法 | 误判后果 |
|---|---|---|
| 首次装机仪式(主动展开) | Agent首次连上中台成功→面板自动全屏展开一次，本地标记位仅触发一次 | 纯被动等客户发现热键=回到静默托盘原点，违背设计动机 |
| desktop-lease-broker失联默认姿态 | fail-closed，查不到就当RPA进行中 | 选fail-open会挡住RPA操作区，同型历史真机事故 |
| 灯态聚合(多task并发) | 前端max()取最高优先级状态 | 不定义会导致灯态竞态闪烁 |
| 看门狗stuck阈值 | 默认90秒，可调 | 太短误报多/太长发现慢 |
| WebView2渲染悖论 | Win32原生MessageBox，零渲染依赖 | 用WebView2渲染兜底=自举死循环，同line04三天死区 |
| 断线重连快照数据源 | 本地Agent内存，不经中台 | 从中台拉=断网期间快照本身就是错的 |
| 展开态被RPA中途插入 | 立即抢占式收起，不等手动 | 继续全屏会挡住新开始的RPA操作 |
| 离线/重连UI态 | Agent崩溃与网络断线合并为一态 | 分开=客户看不懂差异，违反thin |
| 中台写入失败策略 | 重试3次+本地留证日志，不阻塞UI | 丢弃=审计断裂；阻塞=拖慢体验 |
| 本地缓冲/列表上限 | 事件缓冲24h或500条，最近完成列表50条 | 无上限=长期运行拖垮面板 |

## 前置工作（已核对，无 TBD）
- [x] API/凭据：无需第三方key，复用中台既有 X-Internal-Token+X-Tenant-Id 认证模式（golden-path-4-smoke.sh Step12已验证）
- [x] desktop-lease-broker：已存在 `services/agent/src/desktop-lease-broker.ts`，直接复用
- [x] WebView2 preflight参考：现有 `services/agent/wechat-rpa/overlay/preflight.py` 有可复用的检测模式
- [x] 现有events.jsonl路径已确认：`_STATE_DIR/events.jsonl`，唯一写者listen_chat.py，本刀新事件总线**必须用不同文件**（如panel-events.jsonl）
- [x] 目标测试环境：windows_cloud（GHA windows-latest，按ZenithJoy CLAUDE.md死规则——ZenithJoy任何UI/Electron类都走windows_cloud，不用真机）；GP-4原有16步smoke继续跑ubuntu-latest等价断言不变，本刀新增的面板可见性Step单独在windows_cloud跑

## 设计参考
- docs/superpowers/specs/2026-07-22-agent-panel-design.md（原始设计文档）
- 可交互mockup（收起/展开全屏/RPA贴边只读三态 + Dashboard互跳），本sprint对话中产出，视觉基准

## 验收标准（Final E2E）
- [ ] golden-path-4-smoke.sh 保持全绿（16步原有判据不变）
- [ ] 新增面板可见性Step：壳进程启动+本地SSE连通+task事件从Agent真实到达面板
- [ ] 首次装机仪式：新装机场景下面板自动全屏展开一次，含上线文案+热键提示；模拟第二次启动不再自动展开
- [ ] 看门狗stuck变异测试：故意掐死handler，亲眼看到stuck红灯真的报过一次（proven-to-fire）
- [ ] smoke正向断言：渲染文本含"智能回复"/"智能获客"/"智能发布"业务语言
- [ ] smoke负向断言：渲染文本不含 line02/line04 内部代号（正则 `!/line0[24]/i.test(renderedText)`）
- [ ] RPA进行中场景：面板检测租约后自动退让贴边穿透，不夺焦不误触；broker失联时同样退让(fail-closed)
- [ ] CI 全绿
