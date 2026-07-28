# Sprint PRD — 作战窗 Agent Panel 刀2：安卓获客(line02)打点+可见性

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付（当前进度 77%）
- **本次推进预期**：Path2（客户智能获客路径，journey_id=afa6abca-53c0-4815-8594-b7fb81ca547f）Step 8 从"运行中不可观测"推进到"运行状态实时可见+卡死可判"

## 背景

2026-07-28 下午 Path2 安卓真机在 staging 复测暴露：`agent_scan_failures` 表新增 22 条真实失败记录，但测试人员全程不知道任务卡在哪一步。`DeviceAccountScanService` 内部有状态机（IDLE/打开面板中/读取列表中/关闭面板中），但从未上报到任何地方。2026-07-22 定稿的作战窗设计已把此能力规划为"刀2"；今日交付的"刀1"（PR #1488 等）只接了 line04（微信客服），line02 仍是未接入占位。本次把这条线正式接上。

## Golden Path（核心场景）

1. 测试/客户在设备上触发一次账号扫描任务 → Agent 状态机进入"打开面板中" → 上报 `task_started`（`line=line02`，`device=<型号>-<agent_id后4位>`）
2. 状态机每次切换 → 上报 `step` 事件（`progress=[n,total]`）→ 作战窗 line02 泳道实时刷新当前步骤
3. 若 3 分钟内无新事件 → 中台看门狗自动标 `stuck`（灯变红），不依赖设备自报
4. 任务完成 → 上报 `done` → 泳道显示"最近完成"，灯带回绿/蓝
5. 任务失败 → 上报 `failed`（带 `error_code`）→ 泳道标红显示失败原因简述

## 边界情况

- 3 分钟内无新事件但任务其实仍在正常执行（长耗时步骤）→ 先按 stuck 处理，后续事件到达后自动恢复，不需要人工干预
- 安卓侧无法直连 `panel_events` 端点时，由现有 `agent-burner.ts`/`acquisition.ts` 上报路径转写一份（判定点已登记，Generator 阶段按现有鉴权链路实测决定）
- 多台同型号设备并发扫描 → 泳道按 `型号+agent_id后4位` 区分，不得合并显示

## 范围限定

**在范围内**：
- `DeviceAccountScanService.kt` 状态机切换时上报 `panel_events`（task_started/step/waiting/stuck/done/failed）
- 中台看门狗 3 分钟无新事件自动标 stuck
- `apps/agent-panel` 新增 line02 独立泳道渲染（展开态"📱 设备名 第N/M步"，收起态灯带按 severity 变色）

**不在范围内**：
- 前台"放弃"控制（另立 Sprint `07282120-dashboard-collect-task-abandon`）
- 暂停（可恢复）控制 — 本次判定点已明确不做
- 客户视图业务语言脱敏分级、画像卡视图合流（原设计"刀3"范围）

## 假设

- [ASSUMPTION: `panel_events` 表 schema（PR #1494 系列）已足够承载 line02 事件，不需要新增字段]
- [ASSUMPTION: 安卓侧事件上报最终走"复用现有端点转写"还是"直连新端点"由 Generator 按实测鉴权链路决定，两种实现都需满足下方 Invariant 约束]

## 预期受影响文件

- `DeviceAccountScanService.kt`（或安卓侧对应上报调用点）：状态机切换处插入事件上报
- 中台 `agent-burner.ts` / `acquisition.ts` 或 panel events 写入端点：新增/复用 line02 事件转写路径 + 3 分钟看门狗判定
- `apps/agent-panel`：新增 line02 泳道组件 + severity 灯带渲染逻辑
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`：新增 Step 31

## NFR 约束

<!-- 来源: decisions 表 category=nfr 查询为空（/tmp/nfr_decisions.json、/tmp/nfr_feature.json 均为 []），以下均为 PrepPRD 已显式指定的主源值 -->
- stuck 判定阈值: **3 分钟**（心跳约 30s，约 6 次未更新触发）— 用户拍板值，PrepPRD 判定点登记表
- 设备标识格式: **型号+agent_id 后4位**（如 `RMX3478-b6ee`）— 用户拍板值，防同型号多台混淆
- 事件上报延迟/吞吐: 待定（PrepPRD 未指定，decisions 无值）
- 可观测: 失败事件必须带 `error_code`，供泳道展示失败原因简述

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，level=area（/tmp/inv_area.json），step/journey_feature 两源查询均为空 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [禁止写死环境假设值] stuck 阈值/心跳间隔等接缝值禁止写死不可推导的假设，需从环境推导或真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产env的接缝断言（如安卓真机是否真的按状态机切换上报）必须真机验证过才算done，未真验只能标 logic-done-pending（来源: area）
- [多设备类型UI区分] 涉及多个 os_type/device_platform 时展示层必须强制区分，不区分则 FAIL——本 sprint 的 line02（Android）泳道必须与刀1已交付的 line04（Windows）泳道物理隔离显示，不得被通用组件悄悄合并成一种（来源: area，decision 8dbe91ee 同源教训）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /api/brain/journeys/afa6abca-53c0-4815-8594-b7fb81ca547f/golden-paths -->
- 视频/图文内容判定门槛+留言触达门槛化（working）: Step1 客户填目标画像描述存 `acquisition_config.target_profile_desc` → Step2 安卓Agent点开视频卡片 → Step3 中台判定API收截图/音频调多模态模型返回matched/rejected/pending → Step4 matched继续抓评论/rejected&pending跳过但保留记录 → Step5 评论打4档标签+rescoreLead重算relevance_score → Step6 达"精准"档判outreach_eligible=true → Step7 buildAssignments生成dm_assignments前置校验outreach_eligible

## E2E 验收

> Planner 初稿此区块留空实现细节，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出。

```bash
# 期望验收点（自然语言，供 proposer 翻译成命令）：
# 1. golden-path-2-smoke.sh 新增 Step 31：模拟一次 account-scan 任务，断言 panel_events 表出现
#    line=line02 的 task_started/step/done 记录
# 2. 看门狗 stuck 断言：手动制造一个 3 分钟无新事件的任务，断言其 severity 变为 stuck
#    （真机段允许等价断言 + TODO 标记）
# 3. apps/agent-panel 单测：line02 泳道渲染逻辑，给定 mock events，断言展示设备名格式为"型号-id后4位"
# 4. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: journey afa6abca-53c0-4815-8594-b7fb81ca547f 在 Brain 中已注册 journey_type=user_facing；本 sprint 核心产出是 apps/agent-panel 前端 UI 泳道渲染，用户/运营者直接肉眼可见任务进度与卡死红灯
## target_environment: local_api
## target_environment_reason: Round 2 修订（Reviewer round1 阻塞问题2）——round1 误套"UI→windows_cloud"全局规则，但本 sprint 实际改动范围是 apps/agent-panel(React 组件/jsdom 单测)、services/agent(Node 桥接模块)、apps/api(Node+Postgres 新端点)，完全不碰 apps/agent-panel-host（WPF 原生壳+WebView2 渲染层，那个才是 windows_cloud 的适用对象，见 agent-panel-host-build.yml runs-on: windows-latest）。本 sprint 的验收载体 golden-path-2-smoke.sh 实际由 ci-l4-e2e-smoke.yml 的 smoke-api-contract job（runs-on: ubuntu-latest，起 postgres service）与 ci-smoke-glob-runner.yml（同为 ubuntu-latest）调用，全程 curl+psql 打真实 Node+Postgres 后端 + vitest(jsdom) 跑前端组件测试，无任何 Windows/WebView2 参与。target_environment 改为 local_api 如实反映"Node+Postgres 后端 + jsdom 前端测试全在 Linux CI 跑"的真实执行环境。
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: Path2-Step8（来源: PrepPRD"锚定 Path2 Step 8"，journey afa6abca 无独立 journey_steps 表记录可查，以 Journey description 中的步骤编号锚定）
