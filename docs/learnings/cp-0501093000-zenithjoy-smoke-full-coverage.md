## ZenithJoy 全功能 smoke 补齐（2026-05-01）

### 根本原因

原 smoke 目录只有 6 个脚本，覆盖了 agent-fleet / license / multi-tenant / skill-registry / work-performance / dashboard-license，漏掉了 9 个功能域：

- ai-video（history/active/generate 链路）
- pipeline（dashboard-stats/trigger）
- fields（CRUD）
- competitor-research（start/status）
- snapshots（ingest/按平台/按 work 查询）
- pacing-config（get/patch）
- topics（CRUD）
- publish-logs（CRUD）
- creator-service（health/topics 转发）

额外发现：`daily_snapshots` 表缺少 `saves` 列（migration 文件有，但 DB 未跑）导致 ingest 写入失败。

### 下次预防

- [ ] 写 smoke 时的 `ingest` 类端点，先用 `psql \d table_name` 确认实际列名，不能只看 migration 文件
- [ ] 新增 feature 时，smoke 脚本必须同 PR 提交（CI `lint-feature-has-smoke` 已覆盖 apps/\*/src，creator service 没有）
- [ ] `pipeline-trigger` 的 `topic` 字段有 Cecelia Brain dedup 约束，smoke 必须用带时间戳的唯一字段名
- [ ] `snapshots/ingest` 的请求格式是 `{platform, items: []}` 不是 per-row 字段，需查路由源码确认
