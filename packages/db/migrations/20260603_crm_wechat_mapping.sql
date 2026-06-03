-- Path 4 Step 2: CRM 微信联系人映射表
-- 将微信联系人（wechat_contact_id）与 CRM 平台记录（crm_row_id）绑定

CREATE TABLE IF NOT EXISTS crm_wechat_mapping (
  id               SERIAL PRIMARY KEY,
  wechat_contact_id VARCHAR(255) NOT NULL,
  crm_row_id        VARCHAR(255) NOT NULL,
  platform          VARCHAR(50)  NOT NULL CHECK (platform IN ('feishu', 'notion')),
  tenant_id         VARCHAR(255) NOT NULL,
  status            VARCHAR(50)  NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (wechat_contact_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_wechat_mapping_tenant ON crm_wechat_mapping (tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_wechat_mapping_platform ON crm_wechat_mapping (platform, tenant_id);
