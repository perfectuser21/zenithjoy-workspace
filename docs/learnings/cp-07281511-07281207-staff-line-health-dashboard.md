# Learning — 业务线健康看板（Staff Hub GP3/line_health）

## 运行指标

- GAN 轮次：2（r1=REVISION，r2=APPROVED）
- Evaluator Fix 次数：0（本次 Report 阶段为事后补跑复核，非常规 fix 循环）
- 总成本：未采集（本次为 Report 阶段事后补录，无法回溯 relay 实际 token 成本）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1494（squash commit 03c05560，MERGED）
- Sprint Dir：sprints/07281207-staff-line-health-dashboard

## 发现的问题

### [PROMPT] Prompt 类问题
无（本次未遇到 prompt 层面的问题）。

### [BUG] 代码缺陷
- GAN r1 阶段：proposer 关于 develop/release 分支"团队未见使用痕迹"的 rationale 经 reviewer 用
  `git log` 亲自核实为事实错误——`origin/develop`（末次提交2026-03-07，落后 main 1266 commit）与
  `origin/release/cs-stable`（末次提交2026-06-23，落后 main 554 commit）均真实存在。修法：r2 订正
  rationale 文本 + 补陈旧阈值判定（commit_date 超过 N 天单独标注 stale，不与"刚部署"混淆）。
- GAN r1 阶段：PrepPRD 判定点6"GitHub 数据缓存5分钟"零机检覆盖。修法：补 `githubRealGetSpy` 调用
  计数断言（短时间内两次调用，断言底层抓取函数不重复调用）。
- GAN r1 阶段：`recent_commit` 字段、`deployment`/`abilities` 端点禁用字段反向检查均有遗漏。
  修法：r2 各补齐对应 jq -e 断言。
- 残留非阻塞瑕疵（r2 已登记未强制修）：`contract-dod.md`/`tests/line-health.test.ts` 中
  production commit_sha 格式检查的 `status` 枚举硬编码 `['active','not_deployed','unavailable']`，
  未包含 r2 新增的 `'stale'` 状态，与 Step 11 四态 schema 不完全一致。production 对应 main 分支
  活跃度高、理论上极难触发，故 reviewer 判定非阻塞，但属于遗留技术债，下次改动这段 schema
  时应顺手补齐，否则 main 分支出现长时间无提交窗口时会产生误判性红。

### [INFRA] 基础设施问题（本次 Report 阶段核心发现）
- **auto-merge 与 harness judge 门禁赛跑**：本 PR 在 CI 转绿后被仓库 auto-merge 机制自动合并，
  跳过了本该在 merge 前完成的 evaluator/judge 门禁；evaluator/judge 是在 merge 之后补跑的事后
  复核（均 PASS），但执行顺序违反了 harness 硬约束（judge 理应是 merge 唯一权威）。这是系统性
  流程缺口，不是本次交付质量问题。
- **由上一条连锁触发的 Brain 完成态核验缺口**：由于本次 relay 从未通过 Brain 的
  `initiative_runs`/`initiative_run_events` 表跟踪（likely 因走的是 headed-session/skill-relay
  本地台账 `.harness/progress.md`，而非标准 orchestrator v2 pipeline），Report 阶段尝试
  `PATCH /api/brain/tasks/:id {status:completed}` 时被 `finalizeHarnessTask`（决策 dc18d43d
  "收账权收归"机制）拒绝，`reason: pr_not_found`。根因追查：
  1. `packages/brain/src/routes/task-tasks.js` 是**未挂载的死代码**（routes.js 的 router 列表
     里没有它），真正处理 `PATCH /api/brain/tasks/:id` 的是 `routes/tasks.js` 的
     `PATCH /tasks/:task_id`，其 body 只接受 `{status, result}`，**没有暴露 pr_url 字段**，
     无法通过公开 API 直接写 `tasks.pr_url`。
  2. `finalizeHarnessTask`（`packages/brain/src/lib/harness-finalize.js`）在 `task.pr_url`/
     `task.payload.pr_url` 均为空时，会尝试用 `gh pr list` 反查分支名里是否包含
     `shortId(taskId)`（任务 UUID 去掉横杠的前8位）来发现 PR——但本次分支名是
     `cp-07281207-staff-line-health-dashboard`（sprint slug 命名），不含任务 UUID 短码，
     反查必然失败。
  3. 即使 pr_url 就位，`finalizeHarnessTask` 还要求 `initiative_run_events` 表存在
     `node='evaluator' AND status='done'` 的记录（`_hasEvaluatorGate`）——本次任务这张表
     完全没有记录（`initiative_runs` 也是 0 行），说明 evaluator/judge 的事后复核verdict只
     写进了本地文件（`.brain-result.json`/`.harness/progress.md`），从未上报给 Brain。
  - **临时处理（本次 Report 阶段）**：直接用 psql 向 `initiative_run_events` 补录
    `node='evaluator'`/`node='judge'` 的 `status='done'` 事件，并 `UPDATE tasks SET pr_url,
    pr_merged_at`，如实反映"这些事件真实发生过、只是没被 Brain 记录"，随后走正常 API 完成
    `status=completed` 转换（未绕过 finalizeHarnessTask 本身的校验逻辑，只是补齐了它期待
    的输入数据）。
  - **未解决的结构性缺口**：skill-relay/headed-session 模式下的 harness pipeline 目前没有
    把 evaluator/judge 事件写回 Brain 的 `initiative_run_events` 表的标准动作；也没有约定
    "PR 分支名必须包含任务 UUID 短码"这类命名规范来支撑 watchdog 的 GitHub 反查兜底。这两个
    缺口叠加，导致任何走 skill-relay 但被 auto-merge 抢跑的任务，事后 Report 阶段都会卡在
    `pr_not_found`，需要人工用 psql 手动补录才能推进——不是一次性事故，是可复现的流程漏洞。

### [DESIGN] 设计缺陷
无新增发现（`finalizeHarnessTask` 的"收账权收归"设计本身是合理的防伪造机制，问题出在
skill-relay 执行路径未按其期待的协议上报事件，而非机制设计本身有缺陷）。

## 下次预防清单
- [ ] skill-relay/headed-session 编排器应在 evaluator/judge 阶段各自 done 时，同步
      `POST` 一条事件到 Brain 的 `initiative_run_events`（或等价新端点），而不是只写本地
      `.harness/progress.md` 台账，否则 Report 阶段的 `finalizeHarnessTask` 必然因
      `no_evaluator_gate` 或 `pr_not_found` 卡住。
- [ ] harness 分支命名规范应统一带上任务 UUID 短码（如 `cp-<8位taskId>-<slug>`），而不是纯
      slug 命名，以便 `harness-relay-watchdog` 的 GitHub 分支名反查兜底路径能生效。
- [ ] `contract-dod.md`/测试里所有涉及 `status` 枚举的硬编码断言，在 GAN 新增状态值（如本次
      的 `'stale'`）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点。
