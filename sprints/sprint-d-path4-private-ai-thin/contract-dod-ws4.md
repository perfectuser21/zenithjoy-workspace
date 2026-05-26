---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: DeepSeek 朋友圈文案草稿 + 写飞书内容排期 + 中台定时（server 时区）

**范围**: 中台 scheduler.ts cron '0 9 * * *'（server 时区，thin 注释）→ /api/wechat/scheduler-tick 对所有已绑微信且画像齐全客户生成朋友圈草稿；画像缺失 skipped(profile_missing)；当日重复 skipped(already_generated_today)；草稿 approval_source NULL（A 路线护栏起点）
**大小**: M
**依赖**: ws1, ws2

## ARTIFACT 条目

- [ ] [ARTIFACT] scheduler.ts 含 cron '0 9 * * *' + server 时区注释
  Test: grep -E "cron.*['\"]0 9 \* \* \*['\"]" apps/api/src/services/scheduler.ts && grep -E "thin.*server 时区" apps/api/src/services/scheduler.ts

- [ ] [ARTIFACT] /api/wechat/scheduler-tick 端点
  Test: grep -E "/api/wechat/scheduler-tick" apps/api/src/routes/wechat.ts

- [ ] [ARTIFACT] wechat-draft.ts 含 generateMomentDraft 函数
  Test: grep -E "export.*generateMomentDraft" apps/api/src/services/wechat-draft.ts

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/scheduler-tick.test.ts`、`tests/ws4/moment-draft.test.ts`，覆盖：

- POST /api/wechat/scheduler-tick {force:true, customer:'客户A'}（画像齐） → response.generated ≥ 1
- 飞书内容排期当日 pending_review 行数 ≥ 1
- LLM-as-judge：草稿对应营销画像 (deepseek 自评 YES)
- 画像未配置客户 → response.skipped 含 {customer, reason:'profile_missing'}
- 同日重复触发 → response.skipped 含 {customer, reason:'already_generated_today'}
- A 路线护栏 SQL: SELECT COUNT FROM wechat_publish_task WHERE type='moment' AND approval_status='approved' AND approval_source IS NULL = 0
