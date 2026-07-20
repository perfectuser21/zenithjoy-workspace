# Handoff：GP-A语音RTC迁移 harness-report补跑 + 结构性根因登记（task_id=unknown，交互式会话）

## verdict: PASS

## 背景

用户找回了之前"豆包语音接入智能客服 Line"的对话，那次对话已经写好了完整的 PrepPRD（GP-A 主动语音触达 — 语音引擎迁移至火山引擎 RTC 对话式AI，thin 骨架），但 PRD 未提交，散落在另一个 worktree（`cp-07201230-gpa-voice-rtc-migration`）里没人接手。本次接力：先按 /dev 路径C 把这份 PRD 点火进 Brain harness_initiative 流程，Brain tick 自动 spawn 容器跑完 planner→GAN→generator→evaluator→judge→merge，**PR #1432 已合并**。但事后核查发现 journey_features 的 thickness/status 从未回写，用户要求查明原因，本次调查+补救即由此展开。

## 完成了什么

### 1. GP-A 语音引擎迁移到火山引擎 RTC 对话式AI（thin 骨架）已交付

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1432（MERGED, merge_commit=ff5b001f）
- 核心交付：`apps/realtime-voice-mvp/rtc-sidecar.js`（RTC sidecar stub）、`services/agent/wechat-rpa/voice_call/rtc_voice_manager.py`（StartVoiceChat/StopVoiceChat thin stub）、`audio_bridge.py`（ws_url 改指向本地 sidecar）、`apps/api/db/migrations/20260720_voice_call_rtc_timestamps.sql`、`.github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh`
- Evaluator PASS（6/6 contract steps，I-9/I-10/I-11/I-12 全覆盖），Judge APPROVED

### 2. 定位并登记了一个结构性 Brain/harness 缺口

**根因**：relay 容器在 Step 6（merge PR #1432）完成后直接以 exit code 0 退出，**Step 7（`Skill(harness-report)`）从未被调用**——尽管 harness-controller 自身硬约束第 6 条明写"完成判据 = PR MERGED + report done，两者齐才许结束 session"。这条约束只存在于 controller 的 prompt 里，没有机械闸门强制；Brain 侧的调度器又仅凭"容器退出码 0"就把 `task.status` 标记为 `completed`，未校验 report 阶段的产出物（`journey_features.updated_at`、`task.pr_merged_at`、`task.notion_synced_at`）是否真的写入。

**后果**：journey_features 三条记录（GP-A主动语音触达 `a0bf3db6`/虚拟声卡音频桥接 `69b2113b`/RTC对话式AI引擎接入 `283fa2dc`）status 卡在 `planned` 约一小时；task 记录的 `pr_url`/`pr_merged_at`/`notion_id`/`notion_synced_at` 全部为空；`review_status`/`quality_gate` 卡在 `pending`。

**已登记 Issue**：`f93a290f-abc2-4951-b2ac-e69aa6dedd30`（P1，harness-infra），建议修法：Brain 侧对 harness_initiative 任务补一道机械校验——容器退出前必须看到 `relay-runs.phase=done` 且 `task.pr_merged_at` 非空才允许把 `task.status` 标 `completed`，否则标 `degraded`/`needs_review`。

### 3. 手动补跑了完整 harness-report Phase A + Phase B

- Step 1: task.result/pr_url/pr_merged_at/pr_status/review_status/quality_gate 已回写 completed（触发了 Brain 自动派生的 `[Staging E2E]` 后续任务 `cp-07201515-ws-16179076` —— 这个派生此前因为字段没回写而从未发生）
- Step 4: journey_features 三条翻牌：`283fa2dc`(RTC对话式AI引擎接入) planned→**done**、`69b2113b`(虚拟声卡音频桥接) planned→**done**、`a0bf3db6`(GP-A主动语音触达) planned→**working**（thickness 均维持 thin，本 sprint 明确是 thin 骨架不加厚）
- Step 3: Report Note 已写入 Notion（Type=Report）
- Step 8: learning.md 真实复盘 + 3 条原子经验写入 Brain learnings 表
- Step 8d: 复盘文档永久留痕于 `docs/learnings/cp-07201643-gpa-voice-rtc-migration.md`（本次已通过 PR #1435 合并）

## 没做的 / 范围外

- 未修复 Brain/harness-controller 侧的结构性缺口本身（容器退出前置校验），只登记了 issue，留给后续 sprint 处理
- 未触发真机验收（xian-rog OTA 至 line04 v1.0.149 + 跑 e2e-verify.sh 验证 OnUserJoined 事件链路）——这是 PRD 里"待后续跟进"的 thin 阶段 TODO，非本次范围
- 未回填 api_registry/db_schema_registry/test_registry（这三张表按 db-update skill 定义是代码扫描自动填，非手动写入表）

## 下一步

- 真机验收 GP-A RTC 语音通话链路（依赖 xian-rog OTA line04 v1.0.149）
- 待 `[Staging E2E]` 任务 `cp-07201515-ws-16179076` 跑完后看结果
- 如果后续要修 issue `f93a290f`（Brain 容器退出前置校验），走 /dev 路径 B（小改动，改 Brain 调度器逻辑）

## 数据源（下一个大脑接续用）

- 原始 harness 任务：`16179076-26eb-4d94-b9cf-f6a1c81e1a4d`（PR #1432, sprints/07201229-gpa-voice-rtc-migration/）
- Issue：`f93a290f-abc2-4951-b2ac-e69aa6dedd30`
- Staging E2E 派生任务：`cp-07201515-ws-16179076`
- Journey：`55d26529-2274-4c30-85fe-168edcef4d76`（智能客服 · GP-A 主动语音触达）
- learnings 表：本次写入 3 条（task_id=16179076...）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1432（merged，主体功能）
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1435（merged，report补跑留痕文档）
- Issue: f93a290f-abc2-4951-b2ac-e69aa6dedd30
