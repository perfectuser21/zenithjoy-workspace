-- Line04 中台 CRM·外层客户表重做 — crm_customers 加「加微信时间 + 身份三态」两列
--
-- 背景（Track C 契约 2026-06-25）：外层 CRM 表从 4 列重做成 6 列
--   姓名(超链接) | 微信号 | 加微信时间 | 意向(A1-A5) | 最近联系 | 身份(客户·接管/黑名单/内部人员)
-- 缺两列，本 migration 补齐：
--
--   add_friend_time  加微信时间（timestamptz，可空）。来自 agent 扫好友上报；旧 agent 不传即 NULL（向前兼容）。
--   identity         身份三态（NOT NULL DEFAULT 'customer'，CHECK 钉死三值）：
--                      customer  = 普通客户（默认）；接管态由 wechat_cs_account_config.blacklist 实时判定（不混进本列）。
--                      blacklist = 已拉黑（展示用标记；AI 接管 gate 仍以 wechat_cs_account_config.blacklist 为准，本列不替代 gate）。
--                      internal  = 内部人员（运营自己/同事，不是客户）→ GET /customers 列表**排除**；
--                                  字段留着将来当系统通知接收人（本 PR 只做「标记 + 排除」，通知发送是 Step2）。
--
-- 为何用独立 identity 列、不复用 blacklist：blacklist 是 wechat_cs_account_config 里的 per-客服机 jsonb，
-- 语义是「AI 是否回他」的接管 gate；而 identity 是「这一行是不是客户」的名册属性，挂在 crm_customers 行上，
-- 两者关注点不同（一个是回复 gate、一个是名册成员资格），混在一起会让「内部人员排除」和「拉黑不回」互相污染。
-- 故新增独立列，blacklist gate 不动。
--
-- 纯 ALTER ADD，不动 PK / UNIQUE / 外键，无数据迁移。幂等：ADD COLUMN IF NOT EXISTS（E2E smoke 可重入）。
-- CHECK 约束用 DO 块条件加（IF NOT EXISTS 不支持约束，重复跑不报错）。

ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS add_friend_time timestamptz,
  ADD COLUMN IF NOT EXISTS identity        text NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_customers_identity_check'
  ) THEN
    ALTER TABLE zenithjoy.crm_customers
      ADD CONSTRAINT crm_customers_identity_check
      CHECK (identity IN ('customer', 'blacklist', 'internal'));
  END IF;
END $$;

COMMENT ON COLUMN zenithjoy.crm_customers.add_friend_time IS
  '加微信时间（agent 扫好友上报，旧 agent 不传即 NULL，向前兼容）。';
COMMENT ON COLUMN zenithjoy.crm_customers.identity IS
  '身份三态 customer/blacklist/internal；internal=内部人员（不是客户，GET /customers 列表排除，留作将来系统通知接收人）。';
