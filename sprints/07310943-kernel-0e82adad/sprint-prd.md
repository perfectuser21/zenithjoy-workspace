# Sprint PRD — 前台放弃安卓获客任务（不可逆取消）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：交付 Path2 安卓获客任务的客户自助不可逆取消闭环

## 背景

客户目前无法主动终止卡住的安卓获客任务。本 Sprint 在前台仪表盘提供“放弃”控制，并以服务端取消意图、Android Agent 安全退出回执和设备冷却期构成真实闭环；不可把“指令已发送”误报为“已取消”。

## Golden Path（核心场景）

范围锚点（thin_prd 原文）：前台放弃按钮->API标记取消意图->下一次心跳下发取消指令给Android Agent->Agent安全退出上报cancelled->前台显示已取消(取消发送与已确认分两态)->5分钟冷却期内拒绝重新触发同设备

客户从前台放弃按钮 → API 标记取消意图 → 下一次心跳下发取消指令给 Android Agent → Agent 安全退出上报 `cancelled` → 前台显示已取消，并在 5 分钟冷却期内拒绝重新触发同设备。

具体：
1. 客户在 `apps/dashboard` 查看自己租户下正在运行的单设备安卓获客（账号扫描/采集）任务，并点击“放弃”。
2. 系统立即记录不可逆取消意图，前台显示“取消中”并禁用重复操作；仅任务所属租户可操作。
3. 服务端在下一次 Android Agent 心跳（不超过 30 秒）下发取消指令，前台明确显示“取消指令已发送，等待设备响应”。
4. Android Agent 收到指令后中断当前状态机步骤，完成既有安全退出动作，不遗留半开的切换账号面板或继续读取列表。
5. Agent 上报 `cancelled` 后，系统才把任务置为终态，前台显示“已取消”。
6. 系统自确认取消起对该设备执行 5 分钟冷却；冷却期内重新触发同设备任务会被拒绝并显示剩余等待时间，期满后可重新发起。

## 边界情况

- 重复点击或重复取消请求不得产生多条相互冲突的指令，界面保持“取消中”。
- 非任务所属租户发起放弃必须被拒绝，且不得泄露任务或设备信息。
- 指令下发后 2 分钟仍无 `cancelled` 回执时，保持“已发送，等待设备响应”，不得乐观判定成功。
- 任务已处于终态时不得再次进入取消流程。
- 冷却期按同一设备判定；返回可观察的剩余等待时间，期满后不再拒绝。

## 范围限定

**在范围内**：`apps/dashboard` 的单任务放弃入口；同租户鉴权；不可逆取消意图；心跳下发；Android Agent 安全退出与 `cancelled` 回执；“取消中/等待响应/已取消”状态；同设备 5 分钟冷却。

**不在范围内**：暂停及恢复；批量放弃；作战窗可见性改造；新增 Agent 通道；取消后恢复原状态机进度。

## 假设

- [ASSUMPTION: 冷却期起点为服务端收到 Agent 的 `cancelled` 确认时间，以避免尚未真实退出时开始倒计时。]
- [ASSUMPTION: 现有客户登录、租户体系、Android 心跳通道和安全退出路径可直接承载本次行为。]

## 预期受影响文件

- `apps/dashboard/`：展示放弃入口、取消两阶段状态、终态和冷却提示。
- `apps/api/`：接收同租户放弃请求、保存取消意图、通过心跳下发、接收终态并实施冷却拒绝。
- `services/agent-android/`：消费取消指令、安全退出并回执 `cancelled`。
- `scripts/` 或现有 Path2 smoke 目录：覆盖真实业务链的可执行验收。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 取消指令须在下一次心跳下发，最长 30 秒；下发后 2 分钟无回执仍保持等待态
- 频控: 同设备确认取消后 5 分钟内拒绝重新触发
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: “取消指令已发送”与“已确认取消”必须分态展示；真实 Agent 回执前不得判成功

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为本业务范围内适用的全量系统铁律 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [测试多租户] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [真环境验证] 依赖真机或真实调用方的接缝断言必须在真目标上验证过才算 done；未真验只能标 logic-done-pending（来源: area）
- [禁止环境假设] 环境假设值不得写死，须从环境推导或在真机校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 和业务内容不得明文进入日志（来源: area）
- [状态枚举复查] 新增取消状态值时须复查全仓硬编码状态断言，避免遗漏同类检查点（来源: area）
- [语义成功] 指令和状态写入的成功判定必须检查语义字段，不得只凭通用 `ok` 标志判定真实送达（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- 视频/图文内容判定门槛+留言触达门槛化: Step1 客户配置目标画像 → Step2 Agent 打开视频 → Step3 多模态判定 → Step4 按判定采集或跳过 → Step5 评论分档重算 → Step6 判定触达资格 → Step7 仅合格线索生成私信任务

## E2E 验收

> 本 Sprint 已进入批准合同 v15 的 Kernel 最终评估；不得重跑 Planner/Proposer/Generator，也不得触发新 workflow。Evaluator 只读取最终 SHA `2b5d6dae27a338cc0ce8ad1d759b3f46185206ce` 的既有真实证据：Android exact-SHA 双跑 `30677699424`（SUCCESS）与 Windows Chrome + real Postgres/API run `30672675248` attempt 2（SUCCESS，2026-08-01T01:45:33Z），然后执行 Judge 与 `review_required` Gate。

```bash
# 可执行入口已由批准合同 v15 固化为本目录 e2e-verify.sh / e2e-verify.ps1；本恢复轮只复用上述同 SHA 运行证据，不再次 dispatch
# 期望验收点：客户放弃 running 任务后依次观察 cancelling/等待设备响应/cancelled；
# 跨租户请求返回 403；5 分钟内同设备重触发被拒并返回剩余时间；期满可重新触发；
# Android Agent 真机收到取消后安全退出且服务端只在真实 cancelled 回执后展示“已取消”。
```

## journey_type: user_facing
## journey_type_reason: 核心入口与最终状态均位于客户使用的 apps/dashboard，并跨越 API 与 Android Agent。
## target_environment: android_realmachine
## target_environment_reason: payload 显式指定 Android physical 真机验收；对应机械枚举 android_realmachine，并以 exact-SHA Android 真机证据为主、Windows 云端证据为跨端补充。
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: step6
