# PrepPRD：客户智能获客路径（Line02）— 抖音私信主动触达 Android 执行路径

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：给已有 Ability"抖音私信主动触达"新增 Android 无障碍服务执行路径（点击后重抓 root 纪律、去重、健康检查、频控、拟人化操作、真送达确认、幂等回传）
- [ ] 另立 Sprint（本次不做）：撤回/编辑已发送私信；抖音 App 控件漂移的自动适配（本次只做定位失败告警，不做自愈）；self-hosted Android CI runner 基础设施（本次真机验证仍走人工，走 local_api 环境）
- [ ] 待讨论：跨平台（Windows/Android）dm_assignments 去重目前中台是否已有唯一约束，需要 Generator 阶段先查现状再决定加不加锁

## Journey 当前状态
- ✅ 抖音私信主动触达（Windows 路径，Playwright，thin，仅 xian-pc 手工验证）
- ✅ Android 采集路径（搜索关键词→点视频→抓评论者，本 sprint 前已修复两个真机 bug：状态机竞态+openSearchBar 陈旧 root，PR #1119/#1120）
- 🔄 抖音私信主动触达（本次推进：新增 Android 执行路径）

## 本次要做的
给 Android 端的 `DouyinCollectService`（或新建同包下的采集/触达服务）新增一条私信发送能力：读取分配给该 Android 小号的 `dm_assignments` 任务，用无障碍服务定位留言人主页、点私信、按共享话术模板输入发送，确认真送达后幂等回传中台。

## Golden Path（用户操作流程，单线性步骤序列）

1. 用户在 Android 设备"设置→无障碍"里为 Agent 开启无障碍服务权限 → Agent 首次注册时上报 `platform=android` 能力 → 系统记录该设备可承接 `dm_outreach` 任务
2. 中台按打分排序把 `dm_assignments` 派给绑定该 Android 小号的 agent（同一 `lead_id` 若已被其他平台的未完成任务占用则跳过，不重复派发）→ Android agent 轮询到任务
3. Android 发送前查本地滚动频率计数器（10 分钟内已发 ≥3 条则本次不发，等下一个时间窗）→ 通过则继续
4. 无障碍服务打开对应留言人的抖音主页（按 `profile_url`/抖音号定位，加随机延时+模拟上下滑动，不机械秒开）→ 每次操作后重新抓取 UI 快照（不复用旧快照）→ 找到"私信"入口并点击
5. 按 `acquisition_config.dm_message`（Android/Windows 共用同一条配置）输入话术 → 点发送
6. 系统读取界面回执（消息气泡出现/输入框清空）确认真送达，仅点击动作成功不算数 → 按 `assignment_id` 幂等回传 `/dm-outreach-result`（带 `platform=android`），重复回传不重复计数/不重复触发下游
7. 用户在 Dashboard 触达记录页（`AcquisitionOutreachPage`）看到这条记录状态变成 `sent`

**失败场景**：
- Step 4 找不到私信入口 / App 未登录被强退 / 更新弹窗遮挡 → 上报 `failed`，不重试，转人工核实，用户在触达记录页能看到 `failed` + 原因
- Step 3 频控不过 → 上报 `limited`，等下个时间窗自动重试
- 抖音 App 版本升级导致控件定位大面积失败 → 需有探测机制（连续 N 次同类失败即告警，不是等全量 failed 才发现）

**工作时间窗**：仅在配置的工作时段内发送（避免深夜异常操作特征），窗口内具体发送时间点随机，不整点/固定间隔触发。

**不包含**：撤回/编辑已发送私信；App 控件漂移的自动适配（仅告警）。

## 客户视角
用户在 Dashboard 上配置好话术模板和小号后，能看到 Android 手机和 Windows 电脑两条通道都在按排好的优先级顺序，克制、拟人化地给高价值线索发私信邀请加好友，触达记录页能实时看到发送状态。

## 完成后用户能
- 让手机上绑定的抖音小号也能自动执行私信触达（此前只有 Windows 电脑能做）
- 在触达记录页区分 Windows/Android 两条通道各自的发送状态
- 不用担心手机小号被封号（频控+拟人化操作内置）

## 涉及的 Ability / Feature
- 抖音私信主动触达（`feature_id=4abe6ab9-aa55-40a0-bd0b-e38f7f8bd840`，加厚：新增 Android 执行面）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] Android 真机（Honor，Tailscale IP `100.91.227.1`，adb 已连通）已登录两个可互发的测试小号（切换头像即可切账号）

### API 与凭据
- [x] `/dm-outreach-result` 接口已存在（Windows 路径已在用），Android 复用同一接口，新增 `platform` 字段
- [x] `acquisition_config.dm_message` 字段已存在（`20260702_100000_acquisition_dm_message.sql`），Android/Windows 共用

### E2E 测试账号
- [x] 两个测试小号均已登录在同一台真机上（可互发验证真实送达）

### 测试 Fixture
- [x] 纯文字消息（如"你好呀"），无需额外素材

### 基础设施
- [x] Android SDK 34 + Gradle wrapper 已在本机装好并验证可编译跑测试（本 sprint 前置工作已完成）
- [x] `target_environment = local_api`：Harness 只做代码/单元测试级验收，真机真发验证由人工在本对话同款流程里手动补（adb + Tailscale 连接已验证可行）

## 验收标准（Final E2E）
- [ ] 频控计数器（10 分钟窗口内 ≤3 条）有单元测试覆盖
- [ ] 无障碍服务"点击后重抓快照"纪律在新代码路径里落实（同 PR #1119/#1120 的模式）
- [ ] `/dm-outreach-result` 按 `assignment_id` 幂等去重有测试覆盖
- [ ] CI 全绿
- [ ] （人工补验）真机用两个测试小号互发一条消息，确认对方能收到，且频控/拟人化滑动操作真实生效
