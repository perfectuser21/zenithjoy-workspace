# Sprint PRD — 获客工作台 IA 重构（Hub 4卡片 + AccountsPage + TasksPage两级）

## OKR 对齐

- **对应 KR**：Line02 客户智能获客路径（journey_id=afa6abca-53c0-4815-8594-b7fb81ca547f，maturity=skeleton）
- **本次推进**：机器管理 UI + 采集闭环 thin→medium（Hub改版 + 两个新页面 + 视频元数据）

## 背景

AcquisitionHubPage 现为4步向导，需改为4模块工作台入口。TasksPage 接旧 keyword_tasks 表，需迁至 acquisition_collect_tasks；视频维度数据（标题/封面/日期）尚无专用表，本次新建 acquisition_collect_videos 并补 agent 抓取逻辑。

## Golden Path（核心场景）

用户从「智能获客」→ Hub 4模块卡片 → 账号管理或采集任务 → 任务下视频及评论两级

具体：
1. 点「智能获客」→ 看到4个模块卡片（账号管理/采集任务/客户分析-占位/触达中心-占位），前两卡片显示本 tenant 实时数字（小号数/任务数）
2. 点「账号管理」→ `/area/acquisition/accounts` → 本 tenant 小号列表（昵称/绑定时间/健康状态 ok|expired|banned）；无小号 → 引导+绑定按钮
3. 点「绑定新小号」→ 已达 N=10 上限 → 按钮置灰+提示升级；否则弹二维码扫码 → 成功 → 列表新增行；超时/失败 → toast 重试
4. 点「采集任务」→ `/area/acquisition/tasks` → 关键词输入框 + 本 tenant 历史任务列表（关键词/状态/视频数/leads数/创建时间，来源 acquisition_collect_tasks）
5. 输入关键词 → 点「开始采集」→ `POST /collect/start` → 列表新增 pending/running 任务；无小号/agent离线 → toast 报错
6. 点任务行 → `/area/acquisition/tasks/:taskId` → 视频卡片列表（标题/封面/日期来自 acquisition_collect_videos；抓取失败降级为视频链接）
7. 展开某视频卡片 → 该视频 leads 表（昵称/留言/AI分级占位/触达状态占位）；空 → 「暂无评论」
8. 任务失败态（sweep-timeouts 已转换）→ 前端展示 error_code + 「重新采集」（同关键词复用 POST /collect/start）

## 边界情况

- 小号已达 N=10：绑定按钮置灰，提示升级
- 视频元数据抓取失败：降级显示视频链接
- 非法 taskId：`GET /collect-tasks/:id/videos` 返回 404
- 跨 tenant 访问两个新 GET API：返回 401/403（IDOR 校验）

## 范围限定

**在范围内**：Hub 改版、AccountsPage、TasksPage两级（新建 `acquisition_collect_videos` 表 + 两个新 GET API + agent 抓取补选择器）、LeadsPage 采集面板移除、DouyinBurnerBindPage UI 废弃

**不在范围内**：客户分析/触达中心内容页（占位）、WS 实时推送、旧 leads API tenant 过滤历史问题、独立 retry 接口

## 假设

- [ASSUMPTION: Hub 实时数字用并行 count 调用，不新增 summary API]
- [ASSUMPTION: `acquisition_collect_videos.video_id` 与 `acquisition_leads.source_video_ids` 元素对应]

## 预期受影响文件

- `apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx` — 4模块卡片
- `apps/dashboard/src/pages/acquisition/AccountsPage.tsx` — 新建
- `apps/dashboard/src/pages/acquisition/TasksPage.tsx` — 改接 acquisition_collect_tasks
- `apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx` — 新建（二级视频+评论）
- `apps/dashboard/src/pages/acquisition/LeadsPage.tsx` — 移除采集面板
- `apps/api/src/routes/acquisition.ts` — 新增两个 GET 端点
- `apps/api/src/db/migrations/` — acquisition_collect_videos 建表
- `services/agent/src/handlers/keyword-search-douyin.ts`（含 .cjs）— 补视频元数据选择器

## NFR 约束

<!-- Brain API 不可达，PrepPRD 未指定 NFR -->
- 超时/延迟: 待定
- 可观测: 新 API 错误须返回结构化 error.code，前端 toast 展示

## Invariant 约束（铁律，proposer/evaluator 不得违反）

（本 line 暂无历史 — Brain API 不可达）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史 — Brain API 不可达）

## E2E 验收

> 占位：proposer 按 target_environment=windows_cloud 写 Playwright `.spec.ts`。**禁止 `|| true` 裸吞退出码**（上轮 PR#1030 被 Contract Gate 拦截根因）；seed 步骤已有 `ON CONFLICT DO NOTHING` 无需兜底；若确需豁免改用 `gate-allow: cheat/or-true <理由>`。

```
期望验收点（自然语言）：
- Step1-7 Golden Path 跑通（Hub→账号管理→采集任务→任务详情→视频→评论）
- AccountsPage 三健康态截图（ok/expired/banned）+ N=10 置灰截图
- 非法 taskId 返回 404；跨 tenant 访问两个新 GET API 返回 401/403
- LeadsPage 采集面板已移除
- CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 核心改动在 apps/dashboard/ UI 页面（Hub/AccountsPage/TasksPage），命中 user_facing 首条规则
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E 走 GitHub Actions windows-latest（路由死规则）
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: L02-Track-A（Hub改版+AccountsPage+TasksPage+视频元数据）
