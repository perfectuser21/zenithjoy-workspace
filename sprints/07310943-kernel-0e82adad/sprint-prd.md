# Sprint PRD — 前台放弃安卓获客任务（不可逆取消）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：交付 Line 02 获客任务的客户自助终止闭环

## 背景

客户目前无法主动终止卡住的安卓获客账号扫描/采集任务。本 Sprint 在前台提供不可逆的“放弃”，经既有心跳通知 Android Agent 安全退出，并用真实回执区分取消发送与取消确认，避免假成功。

## Golden Path（核心场景）

范围锚点：前台放弃按钮->API标记取消意图->下一次心跳下发取消指令给Android Agent->Agent安全退出上报cancelled->前台显示已取消(取消发送与已确认分两态)->5分钟冷却期内拒绝重新触发同设备

客户从前台仪表盘的运行中安卓获客任务进入 → 点击放弃按钮 → API 标记取消意图 → 下一次心跳下发取消指令给 Android Agent → Agent 安全退出并上报 `cancelled` → 前台显示已取消 → 同设备经过 5 分钟冷却后可重新触发。

具体：
1. 客户看到自己租户、自己设备上处于运行中的账号扫描/采集任务及“放弃”按钮。
2. 客户点击“放弃”并确认后，系统立即将任务展示为“取消中”，按钮置灰且重复请求不产生第二次取消。
3. 服务端在下一次心跳（不超过 30 秒）向对应 Android Agent 下发取消指令；前台显示“取消指令已发送，等待设备响应”。
4. Agent 中断当前状态机步骤，完成安全退出，不遗留半开的切换账号面板或继续读取列表，并上报 `cancelled`。
5. 系统收到回执后将任务置为终态；客户前台只在此时显示“已取消”。
6. 系统为该设备建立 5 分钟冷却期；期间重新触发会被拒绝并显示剩余等待时间，期满后允许新任务。

## 边界情况

- 非任务所属租户发起放弃时拒绝操作，不泄露任务或设备详情。
- 已结束、已取消或非运行中任务不接受放弃；重复点击保持同一结果。
- 取消指令下发后 2 分钟仍无 Agent 回执时，保持“已发送，等待设备响应”，不得显示“已取消”。
- Agent 安全退出失败或离线时不伪造 `cancelled`；恢复通信后仍可接收未确认的取消意图。
- 冷却期按设备隔离，不阻断其他设备；同设备并发重试均被拒绝。

## 范围限定

**在范围内**：单个运行中安卓获客任务的客户自助不可逆放弃、取消意图、心跳下发、安全退出、`cancelled` 回执、前台两态展示、同设备 5 分钟冷却与剩余时间提示。

**不在范围内**：暂停或恢复、批量放弃、作战窗可见性改造、改变账号扫描业务步骤、未回执时乐观判定成功。

## 假设

- [ASSUMPTION: 既有客户登录、租户鉴权、Android Agent 心跳命令通道与安全退出能力保持可用。]
- [ASSUMPTION: 冷却期从服务端确认收到 `cancelled` 的时刻开始计算。]

## 预期受影响文件

- `apps/dashboard/`：展示运行中任务的放弃入口、取消两态、冷却期与剩余等待时间。
- `apps/api/`：接收同租户放弃意图、在心跳中下发取消并处理 Agent 回执与冷却约束。
- `apps/android/`：Android Agent 接收取消指令、安全退出并回执 `cancelled`。
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`：覆盖 Line 02 step6 的取消闭环与隔离/冷却回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 取消指令须在下一次心跳下发，最长 30 秒；下发后 2 分钟无回执仍不得假定取消成功。
- 频控: 同设备收到 `cancelled` 后进入 5 分钟冷却，期间所有新触发均拒绝并返回剩余等待时间。
- 版本要求: 待定（PrepPRD 未指定）。
- 可观测: 前台明确区分“取消中/等待设备响应”与“已取消”，仅真实 `cancelled` 回执可进入已取消终态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单槽串行] 同一 slot 同时只允许一个任务运行，任务内只读工作可并行但写代码实现者仅一个（来源: area）
- [环境参数] 环境相关值必须从环境推导或真机校准，禁止写死假设值（来源: area）
- [真环境] 依赖真机、生产环境或真实调用方的接缝断言必须在真实目标验证，未真验不得标记 done（来源: area）
- [多租户测试] 单元与 E2E 默认使用至少两个租户并断言互不串数据（来源: area）
- [凭据安全] secrets 不硬编码、不进入 Git、不进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，绝不跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- 视频/图文内容判定门槛+留言触达门槛化: Step1 客户配置目标画像 → Step2 Agent 打开视频 → Step3 多模态判定 → Step4 按结果抓取或跳过 → Step5 评论分档 → Step6 判定触达资格 → Step7 发送前复核资格

## E2E 验收

> Proposer 须将以下验收点转成 `windows_cloud` 可执行脚本，并覆盖真实业务内核链路。

```powershell
# 占位：proposer 将在 Windows GitHub Actions 合同中填入真实 API、Dashboard 与 Android Agent 验收命令。
# 期望验收点：运行中→放弃→取消中→心跳下发→安全退出回执 cancelled→已取消。
# 还须断言：跨租户请求被拒绝；无回执不假成功；冷却期内同设备重触发被拒绝并返回剩余时间；期满恢复。
```

## journey_type: user_facing
## journey_type_reason: Golden Path 从 apps/dashboard 客户操作入口开始，并跨 API 与 Android Agent 完成可观察闭环。
## target_environment: windows_cloud
## target_environment_reason: zenithjoy payload 明确指定 windows_cloud，由 GitHub Actions windows-latest 执行 Windows 产品验收。
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: step6
