# Sprint PRD — 前台放弃安卓获客任务（不可逆取消）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：交付客户可自助终止异常安卓获客任务的完整前台到 Agent 闭环

## 背景

客户目前无法主动终止卡住的安卓获客（账号扫描/采集）任务。本 Sprint 让客户在前台仪表盘发起不可逆放弃，并以 Android Agent 的真实回执作为取消成功依据，避免界面假成功和同设备立即重试。

## Golden Path（核心场景）

客户从前台放弃按钮 → API 标记取消意图 → 下一次心跳下发取消指令给 Android Agent → Agent 安全退出上报 `cancelled` → 前台显示已取消（取消发送与已确认分两态）→ 5 分钟冷却期内拒绝重新触发同设备。

具体：

1. 客户打开前台仪表盘，看到自己租户下某设备正在运行的安卓获客（账号扫描/采集）任务及“放弃”按钮。
2. 客户点击“放弃”，系统立即记录不可逆取消意图，前台显示“取消中”并禁用重复操作。
3. 服务端在下一次 Android Agent 心跳中（不晚于 30 秒）向该设备下发取消指令。
4. Agent 收到指令后中断当前流程，完成安全退出且不遗留半开的切换账号面板或继续读取列表，并上报 `cancelled`。
5. 取消指令已发送但尚未收到回执时，前台显示“取消指令已发送，等待设备响应”；只有收到 `cancelled` 回执后才显示“已取消”。
6. 系统从取消确认起对该设备执行 5 分钟冷却；冷却期内重新触发会被拒绝并显示剩余等待时间，期满后才允许新任务。

## 边界情况

- 非任务所属租户的客户尝试放弃时拒绝操作，不改变任务或设备状态。
- 对非运行中任务、重复放弃请求或已进入终态的任务，不重复下发取消指令。
- 取消指令下发后 2 分钟仍无 Agent 回执时，保持“等待设备响应”，不得显示“已取消”。
- Agent 离线或心跳延迟时保留取消意图，待其后续心跳下发；不得把“已发送”等同于“已确认”。
- 冷却期按设备隔离，不阻塞其他设备；同设备并发重试均被拒绝并返回一致的剩余时间。

## 范围限定

**在范围内**：单个运行中安卓获客任务的客户自助不可逆放弃、租户鉴权、取消意图、心跳指令、Agent 安全退出与 `cancelled` 回执、前台两态展示、同设备 5 分钟冷却。

**不在范围内**：暂停或恢复、批量放弃、作战窗可见性、变更现有账号扫描业务步骤、无回执时强制宣告取消成功。

## 假设

- [ASSUMPTION: 5 分钟冷却从服务端确认 `cancelled` 的时间开始计算；若现有业务规则已有更严格起点，则采用更严格规则。]
- [ASSUMPTION: 前台已有客户登录、租户上下文和单设备任务标识，可唯一定位待放弃任务。]
- [ASSUMPTION: Android Agent 现有心跳命令通道和安全退出收尾能力可承载本次取消行为。]

## 预期受影响文件

- `apps/dashboard/`：展示“放弃”操作、取消中/等待响应/已取消状态及冷却剩余时间。
- `apps/api/`：接收放弃请求、校验租户归属、记录取消意图、拒绝冷却期重试并对外返回可观察状态。
- `apps/android/`：在 Android Agent 心跳消费取消指令，安全退出并回执 `cancelled`。
- `scripts/e2e/`：覆盖前台到 API、心跳、Agent 回执、两态展示、租户隔离和冷却拒绝的 Golden Path 验收。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 下一次心跳下发取消指令，端到端下发延迟 ≤30 秒；下发后 2 分钟无回执仍保持等待响应
- 频控: 同设备取消确认后 5 分钟内拒绝重新触发
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 取消发送与 Agent 已确认必须分两态；仅 `cancelled` 回执可进入“已取消”

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [真环境验证才算 done] 依赖真机、生产 env 或真实调用方的接缝断言必须在真目标上验证；未真验只能标 logic-done-pending（来源: area）
- [禁止写死环境假设值] 环境假设值不得写死，须从环境推导或真机校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 和聊天内容不得明文进日志（来源: area）
- [单 slot 串行] 一个 slot 内任务串行；动手写代码的实现者同一时刻只有一个（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成或 working ability 的 golden_path，按 ability 分组、order_no 排序 -->
- 视频/图文内容判定门槛+留言触达门槛化: Step1 客户配置目标画像 → Step2 Agent 打开视频 → Step3 多模态判定 → Step4 按判定抓取或跳过 → Step5 评论分档重算 → Step6 判定触达资格 → Step7 仅为合格线索生成私信任务

## E2E 验收

```bash
# 占位：proposer 将按 windows_cloud 填入真实 PowerShell/GitHub Actions 脚本
# 期望验收点：客户在 Dashboard 放弃自己租户的 running 任务后，观察 cancelling/等待响应；
# Android Agent 在下一次心跳收到取消、安全退出并回执 cancelled 后，前台才显示已取消；
# 跨租户请求被拒绝；同设备 5 分钟内重试被拒绝并返回剩余等待时间，期满可再次触发。
```

## journey_type: user_facing
## journey_type_reason: Golden Path 由客户在 apps/dashboard 前台页面发起，包含明确可见的交互和状态变化。
## target_environment: windows_cloud
## target_environment_reason: task payload 显式指定 windows_cloud，ZenithJoy Dashboard 与 Android 产品链路由 GitHub Actions windows-latest 执行。
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: step6
