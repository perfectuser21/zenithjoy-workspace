# Learning — GP-A 主动语音触达 — 语音引擎迁移至火山引擎 RTC 对话式AI（thin 骨架）

## 运行指标

- GAN 轮次：2（R2 APPROVED 34/35）
- Evaluator Fix 次数：0（评估直接 PASS，6/6 contract steps）
- Generator CI 修复轮次：6 轮
- 总成本：约 $10.24（容器内 claude 进程自报 total_cost_usd）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1432
- Sprint Dir：sprints/07201229-gpa-voice-rtc-migration

## 发现的问题

### [PROMPT] Prompt 类问题
无（本次未遇到，Planner/GAN/Generator/Evaluator 各阶段按合同顺利推进）。

### [BUG] 代码缺陷
无（本次未遇到，Evaluator 一次性 PASS，未触发 fix loop）。

### [INFRA] 基础设施问题
- **relay 容器在 Step 6（merge）完成后异常退出，跳过了 Step 7（report）**：harness-controller 自身硬约束第 6 条明确要求"完成判据 = PR MERGED + report done，两者齐才许结束 session"，但这次实际执行中容器在合并 PR #1432 后直接以 exit code 0 退出，未调用 `Skill(harness-report)`。根因是这条硬约束只写在 controller 的 prompt 里，没有配套的机械闸门强制执行；Brain 侧的任务调度器又把"容器退出码为 0"直接等同于"任务已完成"，未校验 report 阶段的产出物（`journey_features.updated_at`、`task.pr_merged_at`、`task.notion_synced_at` 等）是否真的写入。后果：journey_features 三条记录（GP-A主动语音触达/虚拟声卡音频桥接/RTC对话式AI引擎接入）的 status 停留在 `planned` 长达约 1 小时，task 记录的 `pr_url`/`pr_merged_at`/`notion_id` 全部为 null，直到人工发现并手动补跑本 report 才修复。已登记 issue `f93a290f-abc2-4951-b2ac-e69aa6dedd30`（P1），建议修法是 Brain 侧对 harness_initiative 任务补一道机械校验：容器退出前必须看到 `relay-runs.phase=done` 且 `task.pr_merged_at` 非空才允许把 `task.status` 标记为 `completed`，否则标记为 `degraded`/`needs_review` 供人工或 watchdog 介入补跑 report。
- 一个附带的积极发现：手动 PATCH `task.pr_merged_at`/`pr_status` 后，Brain 侧自动派生出了一个 `[Staging E2E]` 后续任务（`cp-07201515-ws-16179076`）——说明"补写 PR 合并字段"本身是触发下游 staging E2E 流程的必要条件，容器提前退出漏掉这一步不仅丢了 Notion 同步，还会让这条 PR 永远进不了 staging E2E gate。

### [DESIGN] 设计缺陷
无新增（本次 sprint 范围内设计判定点均按合同登记表执行，无偏差）。

## 下次预防清单

- [ ] Brain 侧给 harness_initiative 任务补一道"容器退出前置校验"：容器进程退出时，若任务 payload 显示已进入 merge 阶段（`generator_done=true` 且 PR 已 MERGED）但 `task.pr_merged_at`/`notion_synced_at` 仍为空，判定为 `degraded` 而非直接 `completed`，触发 watchdog 补跑 report（对应 issue f93a290f）
- [ ] harness-controller Step 7 前追加一条自检 bash（`gh pr view --json state -q .state` 确认 MERGED 后，紧跟着必须看到本地 `.harness/progress.md` 出现 `report: done` 行才允许进程退出），把"软约束"落地成"退出前置检查"，不依赖 LLM 自觉记得调用最后一步
- [ ] 定期（如每周）扫一次 `journey_features` 表里 `updated_at` 明显早于对应 journey 最近一次 PR 合并时间的记录，作为"report 阶段漏跑"的兜底探针，而不是只依赖用户偶然发现
