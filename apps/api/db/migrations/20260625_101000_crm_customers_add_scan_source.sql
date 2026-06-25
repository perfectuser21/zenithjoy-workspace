-- Line04 CRM 重做 迁移 B（方案 B1）— crm_customers 扩 scan 源 + last_message/last_seen
--
-- friend-scan 落库走 B1：扩 crm_customers source CHECK 加 'scan'，agent 扫客服机近期会话联系人
-- upsert 落 source='scan'，复用 buildCustomerRoster 四源合并（最小改动，不另起 crm_contacts 表）。
-- last_message = 扫描时最后消息预览；last_seen_at = 扫描观测到的最后时间。均可空。
--
-- 幂等可重入：先 DROP 旧 source CHECK 再 ADD（含 'scan'）；列 ADD IF NOT EXISTS。

ALTER TABLE zenithjoy.crm_customers
  DROP CONSTRAINT IF EXISTS crm_customers_source_check;
ALTER TABLE zenithjoy.crm_customers
  ADD CONSTRAINT crm_customers_source_check
    CHECK (source IN ('message','manual','scan'));

ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS last_message text;
ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN zenithjoy.crm_customers.last_message IS
  'agent 扫描时观测到的最后消息预览（source=scan 时填，可空）';
COMMENT ON COLUMN zenithjoy.crm_customers.last_seen_at IS
  'agent 扫描观测到的最后时间（source=scan 时填，可空），名册聚合并进 last_contact_at';
