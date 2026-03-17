# Learning: scraper 采集数据关联 work_id

**任务**: 快手 scraper 通过 platform_post_id 关联 zenithjoy.publish_logs
**分支**: cp-03171042-scraper-work-id
**完成日期**: 2026-03-17

---

### 根本原因

现有 `sync-scraper-to-works.sh` 脚本已做后置标题模糊匹配，但精度不够——title 可能跨平台重复，且是后置批量脚本。本改动在 scraper 采集时实时通过精确 `platform_post_id` 关联，准确率更高。

### 发现的关键事实

1. `zenithjoy.publish_logs` 在 `cecelia` 数据库，而 scraper 连的是 `social_media_raw` 数据库——两个 DB Client 是正确做法，不能用 dblink
2. `metrics` 是 `publish_logs` 的 JSONB 字段（不是 `response` 字段），由采集脚本回填，这是正确的字段
3. scraper 已经提取了 `workId`（`item.workId || item.publishId || item.photoId`），对应 `platform_post_id`
4. `sync-scraper-to-works.sh` 更新的是 `response` 字段中的嵌套 metrics，而本改动更新的是直接的 `metrics` 字段——两者并不冲突

### 下次预防

- [ ] 接入新 scraper 时，先检查是否已有后置同步脚本，评估是否需要改为实时关联
- [ ] 修改 scraper 时，确认两个 DB 的连接参数（user/password/database）
- [ ] 凡跨数据库访问，第二个连接必须有 try/catch 且不影响主流程
