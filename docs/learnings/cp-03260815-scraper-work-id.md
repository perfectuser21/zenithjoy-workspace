# Learning: 剩余5个平台 scraper work_id 关联

## 背景
为 zenithjoy 8个平台采集器中尚未实现 work_id 关联的 5个（zhihu/xiaohongshu/toutiao/wechat/channels）添加了 zenithjoy.publish_logs 关联逻辑。

---

### 根本原因
各平台的 platform_post_id 来源不同，需要针对性提取策略：
- API 型（zhihu）：直接从 API 响应的 `item.id` 字段获取，最可靠
- DOM 链接型（xiaohongshu/toutiao）：需从页面链接 href 中用正则提取 ID
- 无 platform_post_id 型（wechat）：只能通过 title 匹配 zenithjoy.works 表
- 不在约束内（channels）：publish_logs.platform 检查约束不含 'channels'，无法直接关联

### 下次预防
- [ ] 新增平台发布器时，先确认 publish_logs.platform 约束是否包含该平台
- [ ] channels 若后续加入发布系统，需同步扩展 publish_logs_platform_check 约束
- [ ] 小红书/头条采用 DOM 链接提取方案，实际 ID 是否能捕获需线上验证（analytics 页面可能不暴露链接）
- [ ] wechat 的 title-based matching 精度依赖标题一致性，如有截断/换行差异可能漏关联
- [ ] 跨仓库任务（Brain 任务在 cecelia，代码在 zenithjoy）需在 zenithjoy 也建 worktree + .dev-mode 才能通过 branch-protect hook
