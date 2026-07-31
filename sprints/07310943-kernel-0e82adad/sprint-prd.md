# Sprint PRD — 前台放弃安卓获客任务（不可逆取消）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：交付 Path2 客户自助终止卡住任务的闭环

## 背景

客户目前无法自行终止卡住的安卓获客任务。本 Sprint 让客户从前台仪表盘发起不可逆放弃，直到 Android Agent 安全退出并明确回执；它不把“指令已发送”误报成“已取消”。

## Golden Path（核心场景）

客户从前台仪表盘的运行中安卓获客任务进入 → 点击“放弃” → API 标记取消意图 → 下一次心跳下发取消指令给 Android Agent → Agent 安全退出并上报 `cancelled` → 前台显示“已取消” → 5 分钟冷却期满后允许同设备重新触发。

具体：
1. 客户看到自己租户、单台设备上正在运行的账号扫描/采集任务及“放弃”按钮。
2. 客户点击“放弃”，系统立即显示“取消中”并置灰按钮，重复点击不产生第二次取消。
3. 服务端在下一次 Android Agent 心跳中（最长 30 秒）下发取消指令；发送后前台显示“取消指令已发送，等待设备响应”。
4. Android Agent 中断当前状态机步骤，完成安全退出，不留下半开的切换账号面板或继续读取列表，并上报 `cancelled`。
5. 只有收到 `cancelled` 回执后，系统才写入取消终态，前台显示“已取消”。
6. 同设备自取消确认起进入 5 分钟冷却期；期间新任务被拒绝并显示剩余等待时间，期满后可重新发起。

## 边界情况

- 操作者与任务租户不一致时拒绝操作，不泄露任务或设备数据。
- 任务已结束或不处于可放弃状态时，不改变终态并返回明确提示。
- 取消请求重复到达时保持幂等，不重复下发或延长冷却期。
- 指令发出后 2 分钟仍无回执时保持“等待设备响应”，不得显示“已取消”。
- Agent 离线期间保留取消意图，恢复心跳后继续下发，不以超时假定成功。

## 范围限定

**在范围内**：单设备运行中任务的不可逆放弃；租户鉴权；取消中/等待响应/已取消三态；心跳下发；Agent 安全退出回执；5 分钟冷却和剩余时间提示。

**不在范围内**：暂停与恢复；批量放弃；作战窗可见性改造；取消前已采集数据的回滚。

## 假设

- [ASSUMPTION: 既有客户登录、租户体系和 Android Agent 心跳命令通道可直接承载本流程。]
- [ASSUMPTION: 冷却期从服务端确认 `cancelled` 的时间开始计算，避免设备尚未退出时冷却提前耗尽。]
- [ASSUMPTION: API 与前台使用服务端时间计算并返回剩余等待时间，不依赖设备本地时钟。]

## 预期受影响文件

- `apps/dashboard/`：呈现放弃入口、取消发送与取消确认两态、冷却期提示。
- Android Agent 获客任务模块：消费取消指令、安全退出并回执 `cancelled`。
- 获客任务 API 与持久化模块：校验租户、记录取消意图/终态、下发心跳指令及执行冷却规则。
- `golden-path-2-smoke.sh`：覆盖 running → cancelling → cancelled、跨租户拒绝和冷却期拒绝。

## NFR 约束

<!-- 来源: PrepPRD 主源；decisions category=nfr 两个副源均为空 -->
- 超时/延迟: 下一次心跳下发，最长 30 秒；下发 2 分钟未回执仍不得假定成功
- 频控: 同设备取消确认后 5 分钟内拒绝重新触发
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 取消发送与 Agent 已确认必须是可区分状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [环境路由] target_environment 必须来自任务 payload，本任务为 windows_cloud（来源: area）
- [真环境验证] 依赖真机、生产环境或真实调用方的接缝断言必须在真实目标验证；未真验只能标 logic-done-pending（来源: area）
- [测试多租户] 单元测试与 E2E 默认至少种两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进入 git、不进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 和聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权；无鉴权端点不得发货（来源: area）
- [租户隔离] 涉及租户数据的查询和写入必须限定当前租户，禁止跨租户混读混写（来源: area）
- [环境假设] 环境相关值不得写死，必须由环境推导或在真机校准（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成或 working ability 的 golden_path，按 ability 分组、order_no 排序 -->
- 视频/图文内容判定门槛+留言触达门槛化: Step1 客户配置目标画像 → Step2 Agent 打开视频 → Step3 中台判定 → Step4 按结果采集或跳过 → Step5 评论分档 → Step6 判定触达资格 → Step7 仅合格线索进入私信

## E2E 验收

```bash
# 占位：proposer 将按 windows_cloud 填入真实 PowerShell 脚本并在 Android 真实接缝补充真机验证。
# 期望验收点：客户在前台放弃本人租户的 running 任务，观察 cancelling/等待响应，
# Android Agent 安全退出并回执后才观察 cancelled；跨租户返回 403；同设备 5 分钟内重试被拒并返回剩余等待时间。
```

## journey_type: user_facing
## journey_type_reason: 核心入口和最终状态都位于 apps/dashboard 的客户前台，且包含 Android Agent 协同。
## target_environment: windows_cloud
## target_environment_reason: zenithjoy 的 Dashboard/Windows 产品按 payload 显式路由至 GitHub Actions windows-latest；Android 真机接缝另须真实目标验证。
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: step6
