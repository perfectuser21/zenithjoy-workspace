# Learning — Line04 客服工作汇总：消息盖客服身份章 + 北京时区每客服每日 4 数

**Sprint**: 06232241-line04-cs-work-stats
**Path**: Line 04 客户私域 AI 接管（管理员看得见每台客服机工作量）

## 问题

对话原文已落 `zenithjoy.cs_memory_messages`（短期滑窗，feature aa2c0f73 done），但缺
「哪台客服处理的」身份字段，无法按客服聚合，没有 stats 接口也没有前台汇总页
（Issue ecf13d74）。且中台跑在美区，直接用 `now()::date` / `msg_day`（美区墙钟）算日界
会把北京凌晨的消息算到前一天（#832 同类坑）。

## 解法

三段接好：
1. **migration** 给 `cs_memory_messages` 加 nullable `cs_wechat_id` + 索引 `(cs_wechat_id, created_at)`。
   nullable 是关键：老数据 / 身份解析失败落 NULL，stats 聚合一律不计入任何客服、不报错、不回填历史。
2. **盖章**：`wechat-draft.ts` 真实自动回复路径 in/out 落库时，经已有身份解析链
   `getCSConfigByAgentId(agent_id)` 解出 `csConfig.wechat_id` 作身份章，调扩展后的
   `appendTenantMessage({..., csWechatId})` 落到**被 stats 聚合的 `cs_memory_messages`**。
   注意旧 `appendMessage` 写的是 `wechat_messages`（另一张表，喂回复上下文）—— 盖章必须落到
   stats 聚合的那张表，所以是**新增一路落库**（保留旧路喂上下文，不替换、不破坏既有回归测试）。
3. **聚合**：`computeCsStats` 纯函数钉死 4 数口径（received=in / reply=out /
   served_customers=distinct contact / work_duration_minutes=末-首 created_at 分钟）；
   `getCsWorkStats` 用 `(created_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date - offset`
   显式北京日界过滤（与服务器美区时区无关），再交纯函数聚合。
4. **前台** `CsWorkStatsPage` 每客服一张卡 + 今天/昨天切换，挂 Line04 私域客服区。

## 踩坑

- **字段名漂移防线**：合同把 `in_count/out_count/wechat_id(裸名)/duration/customers` 等列为禁用名，
  纯函数单测 `Object.keys` 反向 `not.toContain`；`computeCsStats` 输出对象只含 5 个 PRD 锚点字段。
- **既有 endpoint-count 回归测**：`wechat.test.ts` 硬断言「exactly 8 endpoints」，加 `/cs/stats`
  后变 9 —— 这是合理的功能新增，更新该计数测试（非 sprint 合同测试，不违反 test-freeze）。
- **lint-feature-has-smoke**：feat + 改 `apps/*/src/` 必须新增 `.github/workflows/scripts/smoke/*.sh`
  （≥5 实质行 + ≥1 真实命令），合同的数据 oracle 在 `sprints/.../scripts/` 不算，须另放 smoke 薄外环。
- **online/mode 是接缝**（seam #2）：真实值需真 health 源，本层只保证类型（boolean/枚举），
  数据 oracle 只断言 4 数口径 + 北京日界 + 不串台 + NULL 不计入（环境无关，CI/psql-seed 绿=done）。

## 不做（YAGNI）

历史趋势图 / 任意日期范围 / 跨客服总计行 / 回填历史老消息身份 / 导出。
