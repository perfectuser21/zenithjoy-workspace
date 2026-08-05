# Staff Hub 员工工作台（Workbench）— 设计

- Brain task: 9cc10ff2-93c5-482e-aa87-9fe316590608（军师台落地序列第 8 件，决策 af0d0818 三层之执行层）
- 目标形态: https://docs.zenjoymedia.media/employee-workbench-preview/ 的 thin 骨架

## 目标
把 Staff Hub 首页从静态介绍页升级为员工工作台：一眼看到"今天轮到我人工判断什么"，
并提供反馈网关（表单→Brain captures 进箱，吃数据地基② 刚上线的去向链）。

## 组件
1. **服务端 apps/api**（模式照 services/acceptance.ts 的 CECELIA_BRAIN_URL 代理）
   - `services/workbench.ts`：
     - `fetchWorkbenchSummary()`：并取 Brain acceptance/pending（复用 fetchPendingRuns）+ Brain tasks in_progress（AI 后台任务）+ tasks completed（近7天完成数，客户端过滤 completed_at）→ `{ metrics: {pending_acceptance, ai_running, completed_7d}, pending_runs, ai_tasks, availability }`
     - `submitWorkbenchFeedback({content, nature?, link?})`：POST Brain `/api/brain/captures`（source='api'，nature 仅接受 'issue'，link→ref_pr_url）→ `{id, status, dedupe_hit?}`
   - `routes/staff.ts` 新增：`GET /workbench/summary`（200 透传）、`POST /workbench/feedback`（content 空→400；service 抛错→502；成功→200）
2. **前端 apps/staff-hub**
   - `HomePage.tsx` 重写为工作台：指标 tiles（待验收/AI 在跑/近7天完成）+ 待处理列表（pending runs → /acceptance/:runKey）+ AI 后台任务条 + 反馈表单（textarea+类型+可选链接，提交后显示回执 capture id）
   - Brain 不可达时诚实显示降级（availability 字段，同 line-health 纪律）

## 不包含
- 需求/评测两类门槛的聚合（skill-eval 无 list 端点，另立）
- Notion 路由展示（captures 进箱后由 Brain 自动路由，本刀只到回执）
- windows_cloud 全量 E2E（本刀 vitest 路由/服务测试 + smoke；E2E 归后续加厚）

## 测试策略
- unit/route：`routes/__tests__/staff-workbench.test.ts`（supertest，照 staff-acceptance.test.ts 模式，TDD 先红）
- service：`services/__tests__/workbench.test.ts`（mock axios，断言转发 payload 与降级语义）
- smoke：`.github/workflows/scripts/smoke/staff-workbench-smoke.sh`（起 api 打 /workbench/summary 断言 200+metrics 键）

## 验收（DoD）
- [ ] [BEHAVIOR] GET /api/staff/workbench/summary 返回 metrics/pending_runs/ai_tasks — tests/staff-workbench.test.ts
- [ ] [BEHAVIOR] POST /api/staff/workbench/feedback 转发 captures 并回执 id — tests/staff-workbench.test.ts
- [ ] [BEHAVIOR] Brain 不可达时 summary 返回 availability=degraded 而非 500 — tests/workbench.test.ts
- [ ] 首页渲染工作台三区 + 表单（组件编译通过，CI 绿）
- [ ] smoke 进 CI glob
