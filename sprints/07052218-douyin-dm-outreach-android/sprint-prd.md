# Sprint PRD — 抖音私信主动触达 · Android 执行路径

## OKR 对齐

- **对应 KR**：Line02 客户智能获客路径 — 抖音私信主动触达能力加厚（Windows-only → Windows+Android 双通道）
- **当前进度**：Windows 路径已 thin 落地（Playwright，xian-pc 手工验证）；Android 采集路径两个真机 bug 已修（PR #1119/#1120）
- **本次推进预期**：Android 端具备私信发送执行面（新增，非替换）

## 背景

Line02 抖音获客的私信触达目前只有 Windows 电脑通道能跑。本 sprint 给 Android 端的 `DouyinCollectService` 新增私信发送能力，让绑定 Android 小号的线索也能被自动触达，与 Windows 通道共用同一套话术配置和回执接口，仅新增 `platform=android` 标识。

## Golden Path（核心场景）

1. Android 设备开启无障碍服务权限 → Agent 上报 `platform=android` 能力 → 中台记录该设备可承接 `dm_outreach` 任务
2. 中台把 `dm_assignments` 派给绑定该 Android 小号的 agent（同一 `lead_id` 若已被其他平台未完成任务占用则跳过）→ Android agent 轮询到任务
3. 发送前查本地滚动频率计数器（10 分钟内已发 ≥3 条则本次不发，等下一个时间窗）
4. 无障碍服务打开留言人抖音主页（按 `profile_url`/抖音号定位，随机延时+模拟滑动）→ 每次操作后重新抓取 UI 快照（不复用旧快照）→ 点击"私信"入口
5. 按 `acquisition_config.dm_message`（Android/Windows 共用）输入话术并发送
6. 读取界面回执（消息气泡出现/输入框清空）确认真送达 → 按 `assignment_id` 幂等回传 `/dm-outreach-result`（带 `platform=android`），重复回传不重复计数
7. 用户在 Dashboard 触达记录页（`AcquisitionOutreachPage`）看到该记录状态变为 `sent`

## 边界情况

- Step 4 找不到私信入口 / App 未登录被强退 / 更新弹窗遮挡 → 上报 `failed`，不重试，转人工核实
- Step 3 频控不过 → 上报 `limited`，等下个时间窗自动重试
- 抖音 App 版本升级导致控件定位大面积失败 → 连续 N 次同类失败即告警（不是等全量 failed 才发现）
- 仅在配置的工作时段内发送，窗口内具体时间点随机，不整点/固定间隔

## 范围限定

**在范围内**：Android 无障碍服务私信发送、频控计数器、点击后重抓快照纪律、真送达确认、按 `assignment_id` 幂等回传、失败/限流上报。

**不在范围内**：撤回/编辑已发送私信；抖音 App 控件漂移的自动适配（仅告警，不做自愈）；self-hosted Android CI runner 基础设施（真机验证走人工）。

## 假设

- [ASSUMPTION: dm_assignments 跨平台去重目前中台是否已有唯一约束未知，Generator 阶段先查现状再决定加不加锁]
- [ASSUMPTION: 频控/工作时间窗/拟人化滑动延时的具体数值遵循 NFR 约束段，真机校准值不得硬编码，须可配置或从环境推导]

## 预期受影响文件

- Android 客户端 `DouyinCollectService`（或同包下新建私信触达服务）: 新增私信发送流程
- Android 端本地频控计数器模块: 新增
- `/dm-outreach-result` 调用方（Android 侧）: 新增 `platform=android` 字段
- 涉及 `dm_assignments` 派发逻辑（中台侧，若需按 lead_id 跨平台去重）: 视 Generator 现状核查结果决定是否改动

## NFR 约束

<!-- 来源: decisions 表 category=nfr 查询为空，以下全部取自 PrepPRD 显式值（主源） -->
- 频控: 10 分钟窗口内 ≤3 条，超限本次不发，等下一个时间窗
- 工作时间窗: 仅配置的工作时段内发送，窗口内发送时间点随机，不整点/固定间隔
- 拟人化操作: 打开主页前加随机延时+模拟上下滑动，不机械秒开
- 快照纪律: 每次无障碍操作后必须重新抓取 UI 快照，不得复用旧快照（同 PR #1119/#1120 模式）
- 幂等: 按 `assignment_id` 去重，重复回传不重复计数/不重复触发下游
- 版本要求: 无（Android SDK 34 + Gradle wrapper 已就绪）
- 可观测: 连续 N 次同类定位失败需告警（探测机制，具体阈值 Generator 阶段核查现有告警框架后确定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line 暂无 step/feature 级挂载） -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [禁止写死环境假设值] 屏幕坐标/UIA 阈值/频控参数等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机的接缝断言（无障碍点击、真送达确认）必须在真机上验证过才算 done，未真验只能标 logic-done-pending（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: /api/brain/journeys/{journey_id}/golden-paths 查询为空（该 journey 暂无按 golden_path 结构化记录的已验收 ability），以下按 PrepPRD Journey 状态段补记 -->
- 抖音私信主动触达（Windows 路径）: Playwright 驱动电脑端浏览器/App，读话术配置发送私信，thin，仅 xian-pc 手工验证过，本 sprint 不得回退其行为
- Android 采集路径: 搜索关键词 → 点视频 → 抓评论者，状态机竞态与 openSearchBar 陈旧 root 两个真机 bug 已修（PR #1119/#1120），本 sprint 新代码复用同一套"点击后重抓 root"纪律，不得引入新的陈旧 root 问题

## E2E 验收

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl + 单元测试 + psql 核查幂等落库）
# 期望验收点（自然语言）：
# 1. 频控计数器单元测试：10分钟窗口内第4条请求被拒绝/延后，日志/返回值可断言
# 2. 无障碍服务"点击后重抓快照"单元测试：mock 连续两次点击操作，断言两次快照对象非同一引用
# 3. /dm-outreach-result 幂等测试：同一 assignment_id 重复 POST 两次，DB 记录只计数一次
# 4. CI 全绿
# 5. （人工补验，不计入 Harness 自动裁决）真机两测试小号互发一条消息，对方收到 + 频控/拟人化滑动真实生效
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 是 Android 设备在后台自动执行私信触达（无障碍服务驱动，非用户在 Dashboard 上直接操作的界面交互），属系统自动跑的执行面
## target_environment: local_api
## target_environment_reason: PrepPRD 已明确 target_environment=local_api；Harness 只做代码/单元测试级验收，真机真发验证由人工在 adb+Tailscale 环境手动补验
## journey_id: 368c40c2-ba63-8120-86a9-c8739cde0d2a
## step_id: 抖音私信主动触达-Android执行路径（feature_id=4abe6ab9-aa55-40a0-bd0b-e38f7f8bd840，PrepPRD 未给出更细 Step UUID）
