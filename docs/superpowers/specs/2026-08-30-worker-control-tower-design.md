# 设计：工作机控制塔可视化 · 第一刀（worker 活动协议 + 总览 + 实时详情）

日期：2026-08-30 · 决策 e14297d4 · feature 79926615 · journey 24987ee5 · GP 锚 `line01/customer_first_success keep-green`
PrepPRD 全文：Brain notes `3ccc40c2-ba63-8154-afaf-de6671a03779`（本地 `sprints/08301310-worker-control-tower/prep-prd.md`）

## 1. 目标与边界

**目标**：主理人在任何地方打开 Dashboard，看到本租户所有 worker（Windows / 安卓）各自在干什么；点开任一台看到实时画面 + AI 步骤流 + 历史。前端只认一套"worker 活动协议"，执行器可换（现在=AI+skill 经 ADB 驱动小龙虾；未来=Agent 代码）。

**不做**：任务派发/上传入口、安卓端与 Windows Agent 推流代码、运营处理"待人工核实"页、改动 `publish_tasks`、其他平台剧本、执行器专用 token、截图对象存储。

## 2. 方案取舍

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 复用 `publish_tasks` + `response` JSONB 存步骤 | 少建表 | ❌ 与安卓 Agent 心跳拉任务的 SQL 纠缠（会被手机抢走）；JSONB 无界膨胀；失败只写 JSONB 不写正表是仓库四次盲修的教训 |
| **B. 新表 `worker_tasks` + `worker_task_steps`，新路由 `/api/workers`** | 与现有发布链完全隔离，正表列可聚合 | ✅ 采用 |
| C. 只做前端，步骤流走临时 JSON 文件 | 最快 | ❌ 无租户隔离、无历史、不可演进 |

画面：中台内存保存每台 worker 最新帧（环形 ≤10 帧），`GET live` 输出 MJPEG；不落盘。截图落服务器盘 `uploads/worker-shots/`，表存 ref。

## 3. 组件

### 3.1 数据（migration `apps/api/db/migrations/20260830_*_worker_tasks.sql`）
```
zenithjoy.worker_tasks(id uuid pk, tenant_id uuid not null, agent_id uuid not null → agents(id),
  title text, executor_id text, status text check in (running,completed,failed,needs_review),
  steps_total int, current_step int, started_at, finished_at, failed_step int, error_code text,
  lease_until timestamptz, evidence jsonb, created_at, updated_at)
partial unique index (agent_id) where status='running'   -- 同 worker 同时仅一条
zenithjoy.worker_task_steps(id, task_id → worker_tasks(id) on delete cascade, step_index int, title text,
  status text check in (pending,doing,done,failed), screenshot_ref text, foreground_pkg text,
  diag_line text, note text, created_at, updated_at; unique(task_id, step_index))
```

### 3.2 API `apps/api/src/routes/workers.ts`（拆分：`workers.executor.ts` 执行器面 / `workers.read.ts` 读面 / `services/worker-live.ts` 帧缓冲 / `services/worker-lease-sweeper.ts`）

执行器面（`internalAuth`）：
- `POST /api/workers/:agentId/tasks` `{title, steps:string[], executor_id}` → 校验 agent 存在 → 事务插 task(running, lease_until=now()+10min) + steps(pending) → 409 若该 agent 已有 running（唯一索引冲突转 409）→ `{task_id, lease_until}`
- `POST /api/workers/tasks/:id/steps` `{step_index, status, screenshot_jpeg_b64?, foreground_pkg?, diag_line?, note?, executor_id}` → 任务非 running→409；executor_id 不匹配→409；`status=failed` 且缺 foreground_pkg/diag_line/screenshot 任一→400；写截图文件→更新 step、task.current_step、续租 10min
- `POST /api/workers/tasks/:id/complete` `{outcome, evidence?, error_code?, failed_step?}` → failed 必带 error_code+failed_step→400；写终态 + finished_at
- `POST /api/workers/:agentId/frame`（body: image/jpeg 原始字节，≤120KB）→ 帧缓冲

读面（登录 + 租户）：
- `GET /api/workers` → 本租户 agents（复用 `agent-machines` 的 normMachine + 在线判据）+ 每台 running 任务摘要（title/current_step/steps_total）+ 今日 completed 数
- `GET /api/workers/:agentId/activity` → 当前任务 + 步骤（screenshot_ref→URL）+ 最近 20 条历史；跨租户→404
- `GET /api/workers/:agentId/live` → `multipart/x-mixed-replace`，从帧缓冲推新帧（无新帧不重发），15s 无帧客户端自行判"画面不可用"；跨租户→404
- `GET /api/workers/shots/:ref` → 截图文件（租户校验）

Sweeper：`setInterval` 60s，`UPDATE worker_tasks SET status='failed', error_code='executor_lost', finished_at=now() WHERE status='running' AND lease_until<now()`；测试可注入间隔。

### 3.3 Dashboard
- `pages/WorkersPage.tsx`（`/dashboard/workers`，菜单"工作机"）：卡片网格，5s 轮询 `GET /api/workers`；卡片=类型徽章(🖥️/📱)+在线点+状态行（空闲 / 正在执行：title 第 x/y 步）+今日完成+按钮"实时"
- `pages/WorkerLivePage.tsx`（`/dashboard/workers/:agentId`）：左 `<img src=/api/workers/:id/live>` + 15s 无 load 事件显示"画面不可用"；右步骤列表（✅/▶️/⬜ + 缩略图 + 时间），1s 轮询 activity；底部历史表
- `api/workers.api.ts` 客户端；注册进 `navigation.config.ts`

### 3.4 执行器接入（本仓库只提供协议与假执行器）
- `apps/api/src/routes/_smoke-fake-worker-executor.ts`：E2E_FAKE_EXECUTORS 模式下的假执行器（按脚本推步骤+帧），供 CI E2E
- rog 推帧器与 AI 执行器脚本的改造在仓库外（PowerShell/skill），验收时由 lead 手动驱动

## 4. 数据流
执行器 `POST tasks` → 卡片 1 次轮询内变"正在执行" → 每步 `POST steps` → 详情页步骤打勾（截图缩略）→ `POST frame` 持续 → `GET live` 画面 → `POST complete` → 卡片回空闲、历史 +1。

## 5. 错误处理
- 失败步骤强制三件套（400 拦）；失联=租约过期→`failed/executor_lost`，不自动重跑；执行器收到 409 停手
- 画面断：仅 UI 提示，不影响任务
- 跨租户：一律 404；截图路径只由服务端生成（ref 不接受路径字符）

## 6. 测试策略
- **unit（vitest, apps/api）**：路由 400/409/404 分支、租约续期、sweeper 过期转态、帧缓冲环形、三件套校验、同 worker 单 running 唯一索引 → `apps/api/src/routes/__tests__/workers.test.ts`、`services/__tests__/worker-live.test.ts`
- **component（vitest, dashboard）**：WorkersPage 卡片状态渲染、WorkerLivePage 步骤状态与"画面不可用"倒计时 → `pages/__tests__/WorkersPage.test.tsx`
- **E2E（Playwright, windows_cloud, E2E_FAKE_EXECUTORS）**：登录→/dashboard/workers 见 android+win32 卡片→假执行器开任务+3 步→卡片"第 3/5 步"、详情 3 个 ✅→推 5 帧→live 10s 内 ≥2 帧且 hash 不同→失败缺三件套 400→跨租户 404→短租约过期 executor_lost
- **smoke**：`.github/workflows/scripts/smoke/worker-activity-smoke.sh`（curl 协议全链 + 断言），接进 CI
- **真机验收（staging）**：lead 用 AI 执行器驱动小龙虾发一条抖音（私密），页面全程可见
