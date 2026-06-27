-- CRM 列偏好服务端持久化表
--
-- 解决「编辑后不保存、换设备/清缓存恢复默认」痛点，改由账号维度（tenant_id + cs_wechat_id）持久化。
-- prefs JSONB 结构（支持多视图扩展）：
--   {
--     views: [{ id, name, columnState, sortModel, filterModel, quickFilter }],
--     activeViewId: string
--   }
-- 本期仅存 1 个默认视图；结构已预留多视图，下刀加视图切换 UI 不改 schema。
--
-- 幂等：纯 CREATE IF NOT EXISTS，可重入。

CREATE TABLE IF NOT EXISTS zenithjoy.crm_view_prefs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  cs_wechat_id  text        NOT NULL,
  prefs         jsonb       NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cs_wechat_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_view_prefs_tenant_cs
  ON zenithjoy.crm_view_prefs (tenant_id, cs_wechat_id);

COMMENT ON TABLE zenithjoy.crm_view_prefs IS
  'CRM 运营台列偏好（列宽/显隐/顺序/排序/筛选/quickFilter）服务端持久化，按 (tenant_id, cs_wechat_id) scope。'
  ' prefs JSONB 多视图扩展结构：{ views:[{id,name,columnState,sortModel,filterModel,quickFilter}], activeViewId }';
