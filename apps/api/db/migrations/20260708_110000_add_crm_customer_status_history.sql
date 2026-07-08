-- Line04 CRM 客户状态历史追踪 — 新建 crm_customer_status_history 表 + 幂等回填
--
-- 背景："装真人"人格项目度量"推进速度"指标需要状态变化历史，
--       当前 crm_customers.status 只保留最新值，无法计算两次状态变化的时间间隔。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + WHERE NOT EXISTS 回填守卫，
--       migration 可重跑，不产生重复行。

CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id           SERIAL PRIMARY KEY,
  tenant_id    UUID         NOT NULL,
  cs_wechat_id TEXT         NOT NULL,
  contact      TEXT         NOT NULL,
  old_status   TEXT,                        -- NULL 表示首次写入（新客户）
  new_status   TEXT         NOT NULL,
  changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csh_tenant_cs_contact
  ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact, changed_at DESC);

-- 幂等回填：只对尚无历史记录的客户插一条初始行
-- NOT EXISTS 守卫确保重跑不产生重复行（FR-01）
INSERT INTO zenithjoy.crm_customer_status_history
  (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
SELECT c.tenant_id, c.cs_wechat_id, c.contact, NULL, c.status, c.updated_at
FROM   zenithjoy.crm_customers c
WHERE  c.status IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1 FROM zenithjoy.crm_customer_status_history h
    WHERE  h.tenant_id    = c.tenant_id
      AND  h.cs_wechat_id = c.cs_wechat_id
      AND  h.contact      = c.contact
  );
