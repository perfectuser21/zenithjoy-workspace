# 设计：cron 每次触发在 Brain 建 device_job（刀1）

> 决策：cron 只是触发器，每次触发必须在 Brain 新建一条任务（2026-09-24 主理人拍板，level=ability）
> Brain task: a04cf3d5-0907-4884-9222-94e369100a9a

## 要解决什么

工作机页显示金诺盛源两台手机 0 任务，但手机确实在跑采收并出线索（09-24 13:50 出线索 19/15）。
读面只查 Brain：`tasks WHERE task_type='device_job' AND assigned_to=ANY(agents.id) AND due_at > NOW()-'2 days'`，
而 Brain 全库只有 9 条 device_job。

## 探索发现：链路一直是活的，只是缺"计划"那一头

| 环节 | 现状 |
|---|---|
| 真机上报生命周期 | ✅ `wr start/step/fail/done`，harvest-cron.sh 的 6 处 exit 0 早退每处都有覆盖 |
| 上报到服务端 | ✅ `POST /api/workers/:agentId/tasks`，agentId 就是 `zenithjoy.agents.id` UUID |
| 落库 | ✅ `zenithjoy.worker_tasks`，7 天 74 条（49 completed / 25 failed） |
| 字段 | ✅ started_at/finished_at/agent_id/error_code/evidence/lease_until 齐全 |
| 生产能否写 Brain | ✅ node 实连验证通过（`nc` 在容器里不存在，别拿它当判据） |
| **缺口** | ❌ worker_tasks 不往 Brain 建 device_job |

所以缺的不是留痕，是**计划那一头**：cron 自己无限跑，Brain 里没有对应的任务记录。
这与 `apps/api/src/db/brain-pool.ts` 的既定用途一致——该池的注释原文就是
「只读排程 + **写 device_job 任务单**」「写进去的仍是真身那张表，不产生第二份账」（决策 e1ec93b2）。

## 架构

桥接点在 `apps/api/src/services/worker-tasks-service.ts`（路由层只转发）：

```
真机 wr start  → POST /api/workers/:agentId/tasks → startTask()
                                                      ├─ 本地 worker_tasks INSERT（现有，事务内）
                                                      └─ COMMIT 后 best-effort：Brain 建 device_job
                                                         并把 brain_task_id 写回 evidence

真机 wr done/fail → POST /api/workers/tasks/:id/complete → completeTask()
                                                      ├─ 本地 worker_tasks UPDATE（现有）
                                                      └─ best-effort：按 evidence.brain_task_id 回写 Brain

租约过期 → sweepExpiredLeases() → 本地置 failed + 同步回写 Brain（否则 Brain 侧幽灵 in_progress）
```

真机脚本改动仅 2 处（为解回环，见下）：`wall-report.sh` 的 start 支持可选 brain job id，
`device-job-claimer.sh` 上报时把它已知的 JOB_ID 传进去。harvest-cron.sh / outreach-tick.sh **一行不改**。

## 四个已识别硬问题与解法

### 1. dedup 唯一索引会吞掉建单（致命，不解则本病原地复现）

Brain 库实测：
```sql
CREATE UNIQUE INDEX idx_tasks_dedup_active ON public.tasks
  (title, COALESCE(goal_id,'000…'), COALESCE(project_id,'000…'))
  WHERE status IN ('queued','in_progress')
    AND COALESCE(payload->>'dedup_by_notion_page','false') <> 'true'
```
金诺两台同时跑「获客采收·AI人工智能训练师」→ title 相同 → 第二条 23505 → best-effort 咽掉 → 页面还是 0。

**解法**：Brain 单 title = `<worker_task.title> · <serial 尾4位> · <HHMM>`，其中 HHMM 取
`started_at` 的 UTC 时分（如 `获客采收·AI人工智能训练师 · 6983 · 1430`）。
同机同词同分钟被两次拉起的极端情况由 worker_task.id 前 6 位兜底追加。
这不是"为绕索引而变丑"——页面本来就需要区分哪台手机、哪一批，是信息增益。
**不采用** `payload.dedup_by_notion_page='true'` 绕闸：那个字段语义是"按 notion page 去重"，借用是 hack。

### 2. 领单器自反馈回环

`device-job-claimer.sh:113` 领到 Brain device_job 后自己会 `wr start` → 若无条件桥接，
每条真派单会再镜像出一条 Brain 单，页面重复计数 + 永久孤儿。

**解法**：claimer 已经持有 Brain 的 `JOB_ID`（第 95 行解析出来的），上报时带上。
传法：`wall-report.sh start <serial> <title> <steps> [brain_job_id]` 第 4 个可选位置参数，
经 body 的 `brain_job_id` 字段送到 `POST /api/workers/:agentId/tasks`；老版本 wall-report
不传该参数时服务端按"无关联"处理（向后兼容，分发滞后不会炸）。
服务端 `startTask` 收到 brain_job_id → **关联**（把它写进 evidence.brain_task_id），**不新建**。
语义也更正确：领单器执行的就是那条 Brain 单，worker_task 是它的执行记录。
不用 title 前缀匹配识别——脆弱，且 `executor_id` 全是硬编码的 `adb-wall`，区分不了来源。

### 3. 幽灵 in_progress

`sweepExpiredLeases()`（worker-tasks-service.ts:128）只改本地
（`UPDATE … WHERE status='running' AND lease_until < NOW()`），不回写 Brain。
执行器丢失 → Brain 侧永远 in_progress，并持续占住 dedup 槽位挡住后续建单。

**解法**：sweep 时同步把 Brain 单回写 `failed` + `error_code='executor_lost'`。

### 4. 假控制权（最危险）

触达单 57 条/天全部涌进排程页，页面每条都带「改时间 / 取消」按钮，
但对这些镜像行做 CAS 对真机零作用——**运营点了取消，手机照跑**。

**解法**：Brain 单写 `payload.read_only=true` + `payload.source='cron'`；
写面（改时间 / 取消）遇到这两个标记一律拒绝并返回明确原因；前端不渲染这两个按钮。
主理人拍板：触达单一起进页面，但标只读。

## 状态映射

| worker_tasks | Brain tasks | 页面 (STATUS_MAP) |
|---|---|---|
| running | in_progress | running |
| completed | completed | done |
| failed | failed | failed |
| needs_review | blocked | blocked |

`due_at` 必填（= started_at）——传 NULL 时 `toScheduleSlot` 会 `new Date(0)` 渲染成 1970-01-01。
`dept` = '智能获客'（采收与触达都属该部门）。
`trigger_source` 必须显式写非系统源——库默认 `brain_auto` 会被 Brain escalation 静默 paused。
`payload.headed_manual=true`——防 Brain tick 把这条活派给 LLM 执行体真去跑一轮采收。

## 失败处理

Brain 写失败**绝不影响** worker_task 主流程（记账是附属，采收是正事）：
- 跨池不能同事务，一律 COMMIT 后补写
- 失败落本地补投队列：`zenithjoy.brain_sync_outbox` 表（api 本地库，字段 worker_task_id /
  op(create|complete|sweep) / payload jsonb / attempts / last_error / created_at），
  下次 startTask 时先补投最多 20 条（主理人拍板 B：不丢，否则页面变成"只显示好天气的任务"）
- 连续失败必须 escalate，不能只写 log

## 已知既有问题（桥接后会如实带过去，不是新引入）

`worker_tasks` 里采收批次存在 `executor_lost`（12~19 分钟的批次租约续期不稳被判执行器失联），
7 天 25 条 failed 中占多数。Brain 侧会同样显示 failed。这是既有误判，本刀不修，但要在
交接单里写明，避免被误认为是本次改动引入。

## 测试策略

| 层 | 覆盖 |
|---|---|
| unit | title 构造（dedup 绕过）、状态映射四档、read_only 标记写入、brain_job_id 关联分支 |
| integration | startTask → Brain 真建单 → 读面 `/api/schedule` 能看见该行；completeTask → 回写；sweep → 回写 failed |
| 变异测试 | 去掉 dedup 绕过 → 同 title 第二条必须报红；去掉 read_only → 写面必须仍拒绝（proven-to-fire） |
| smoke | `.github/workflows/scripts/smoke/` 新增，进 CI 基线 |

## 不包含

- v4 + ledger.mjs 账本接入（那套从没上过机）
- `deploy.sh` 漏分发 `ledger.mjs` 的缺口（独立问题，另记）
- executor_lost 租约续期不稳的根治
- 模型 / token 字段口径（刀4）

## 验收

- [ ] failing test 先 commit，实现后转绿
- [ ] 变异测试过（亲眼看守卫报红）
- [ ] 今晚夜批跑完，金诺 `e78461d8` / `84979aba` 两台在工作机页显示当天批次、状态与线索数
- [ ] 触达单一并显示且**没有**改时间/取消按钮
- [ ] CI 全绿
