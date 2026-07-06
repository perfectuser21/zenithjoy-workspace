# Bug PrepPRD：getCSConfig 漏查 takeover_mode/blacklist——"全接管"形同虚设

## 症状
rog（cs-425b144f）库配 takeover_mode=blacklist（默认全接管）+ blacklist=[]，但苏小妖/于瑾
带 [4条]/[3条] 红点在视口内被静默跳过（连会话都不开），只回 whitelist 遗留测试名单里的默忆。

## 根因（真机探针实锤 2026-07-06 18:00）
`apps/api/src/services/wechat/cs-account-config-store.ts` getCSConfig 的 SELECT
只查 `wechat_id, persona, business_kb, auto_agent_enabled, business_hours_start,
business_hours_end, key_contact_wechat, whitelist, daily_limit, updated_at`——
**漏 takeover_mode 和 blacklist 两列**。`/api/wechat/cs/agent-config` 响应因此永远
不含这两字段 → agent 端 cs_config_gate.should_reply 按"无 takeover_mode 存量配置"
回退白名单模式 → 只回 whitelist 内的人。推论：whitelist 为空的 blacklist 模式客服机
一个人都不回（历史"名单内静默不回"悬案的可疑根子）。
前台 CRM 接管开关（PUT /api/crm/customers/manage 写 blacklist）因此形同虚设。

## 修法
getCSConfig SELECT 补 `takeover_mode, blacklist` 两列 + normalizeRow 透传 +
CSAccountConfig 类型补字段。不动 agent（cs_config_gate.should_reply 已正确支持）。

## Regression Test 计划（永久留 CI）
cs-account-config-store.test.ts：getCSConfig 返回对象必须含 takeover_mode 与 blacklist
（库行有值时原样透传；未配时字段存在且为默认/null，不得丢失）。

## 关联
- Issue 3eaa7fe6-8e50-4daa-b5a8-2794a103f11b（P0）/ Task 88dd68c5-446a-4899-9712-0e3e0973437e
- Journey Line04（bfeed805）；关联决策：blacklist 主模型（#954 系）
- 临时缓解：staging cs-425b144f whitelist 已手工加苏小妖/于瑾/于锦（修完主模型生效后该名单自然失效）

## 验收标准
- [ ] failing test 先 commit（commit-1），修复 commit-2 变绿
- [ ] CI 全绿
- [ ] merge 后 staging：GET /api/wechat/cs/agent-config?machine_id=425b... 响应含 takeover_mode='blacklist' 与 blacklist=[]
- [ ] rog 真机：非白名单联系人（新名字）发消息也能收到回复（全接管真生效）
