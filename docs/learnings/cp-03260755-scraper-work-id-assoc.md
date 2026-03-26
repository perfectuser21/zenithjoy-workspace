# Learning: scraper work_id 关联 — 抖音+微博 改造

**任务**: 审查8个scraper脚本并为抖音/微博添加 work_id 关联
**分支**: cp-03260755-scraper-work-id-assoc
**完成日期**: 2026-03-26

---

### 根本原因

8个平台采集脚本中，只有快手（cp-03171042）已实现 linkWorkId()。
通过审查发现，只有**抖音**（aweme_id）和**微博**（weiboId）已在 allItems 中携带平台帖子ID，可以直接复用快手的模式改造。
其余5个平台（头条/微信/小红书/视频号/知乎）没有提取 platform_post_id，需要先改采集逻辑，属于独立任务。

### 关键事实

1. **8个 scraper 的 postId 现状**：
   - 快手: `workId` ✅（已完成）
   - 抖音: `aweme_id` ✅（本PR）
   - 微博: `weiboId` ✅（本PR）
   - 头条/微信/小红书/视频号: 仅 title+time，无 postId
   - 知乎: 无 DB 实现，仅保存 JSON 文件

2. **改造模式（快手模板，可复用）**：
   - zenithjoyClient: cecelia DB，user=cecelia, password=CeceliaUS2026
   - 主 DB（social_media_raw）连接失败会中止，zenithjoyClient 连接失败非致命
   - linkWorkId 函数内部 try/catch，确保不影响主采集

3. **微博 DB 连接不同**：微博的主 DB 使用 n8n_user/n8n_password_2025，但 zenithjoyClient 仍用 cecelia 账号

4. **抖音脚本存在预存在 bug**：原代码在 output 中引用了 `newCount`/`snapshotCount`，但实际 save 循环只统计 `savedCount`。本PR将这两个字段改为 `saved: savedCount`，保持语义一致。

### 下次预防

- [ ] 接入新 scraper 时，核查 allItems 是否包含 platform_post_id 字段
- [ ] 改造前先看快手脚本作为模板，确认 zenithjoyClient 配置（user/password/database）
- [ ] 头条/微信/小红书/视频号的 postId 提取方案需要各自评估 API 或 DOM 路径
- [ ] 知乎 scraper 需要先补充 DB 写入能力才能做 work_id 关联
