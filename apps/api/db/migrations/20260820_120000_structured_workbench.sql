-- 路③ 结构化工作台 Sprint A —— JSONB 五表存储底座 + G1 旧字段表租户列
--
-- 设计口径（合同 NFR / Invariant 逐条）：
--   * JSONB 行存，**零运行时 DDL**：用户建的"表"是 db_tables 里的一行，用户录的"数据"是
--     db_rows.data 里的一个 JSONB 对象。用户输入永远是数据值，永不进 SQL 标识符位。
--   * 五张表逐个 org_id UUID NOT NULL：组织归属是硬约束，不是应用层约定。
--   * 删除一律软删（deleted_at），物理行保留 30 天可还原。
--   * 全部 DDL 幂等（IF NOT EXISTS / DO $$ 守卫）：CI 会重放全部 migration，
--     非幂等语句第二次必炸。
--
-- 命名口径：路③ 侧一律 org_id（对齐知识中枢家族）；works 家族的旧表走 tenant_id，
-- 两套并存不合并（合同 G1 裁定 + INV-10 decision）。

BEGIN;

-- ==================== 1. db_tables —— 用户建的"表"本身 ====================

CREATE TABLE IF NOT EXISTS zenithjoy.db_tables (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL,
  name             TEXT NOT NULL,
  -- 'org' = 组织可见；'private' = 仅自己。表级可见性是真访问控制，不是前端显示过滤。
  visibility       TEXT NOT NULL DEFAULT 'org',
  -- 建表人（better-auth user.id / 飞书 open_id）。private 表的可见性判据就是它。
  owner_member_id  TEXT NOT NULL,
  template_key     TEXT,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'db_tables_visibility_chk') THEN
    ALTER TABLE zenithjoy.db_tables
      ADD CONSTRAINT db_tables_visibility_chk CHECK (visibility IN ('org', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_db_tables_org ON zenithjoy.db_tables(org_id);
CREATE INDEX IF NOT EXISTS idx_db_tables_org_live ON zenithjoy.db_tables(org_id) WHERE deleted_at IS NULL;

-- ==================== 2. db_fields —— 表的字段定义（8 类） ====================

CREATE TABLE IF NOT EXISTS zenithjoy.db_fields (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id       UUID NOT NULL REFERENCES zenithjoy.db_tables(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL,
  name           TEXT NOT NULL,
  -- 八类逐字：text / long_text / number / date / single_select / multi_select / person / url
  field_type     TEXT NOT NULL,
  options        JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'db_fields_type_chk') THEN
    ALTER TABLE zenithjoy.db_fields
      ADD CONSTRAINT db_fields_type_chk CHECK (field_type IN (
        'text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'person', 'url'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_db_fields_table ON zenithjoy.db_fields(table_id, display_order);
CREATE INDEX IF NOT EXISTS idx_db_fields_org ON zenithjoy.db_fields(org_id);

-- ==================== 3. db_rows —— JSONB 行存（Sprint B 写入，本刀只建） ============

CREATE TABLE IF NOT EXISTS zenithjoy.db_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id    UUID NOT NULL REFERENCES zenithjoy.db_tables(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL,
  -- 单元格值一律作为 JSONB 数据值存放，key = db_fields.id。零运行时 DDL 的载体。
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_order   INTEGER NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_rows_table ON zenithjoy.db_rows(table_id, row_order);
CREATE INDEX IF NOT EXISTS idx_db_rows_org ON zenithjoy.db_rows(org_id);

-- ==================== 4. db_view_prefs —— 每人每表的视图偏好（Sprint C） ============

CREATE TABLE IF NOT EXISTS zenithjoy.db_view_prefs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id    UUID NOT NULL REFERENCES zenithjoy.db_tables(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL,
  member_id   TEXT NOT NULL,
  prefs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_view_prefs_org ON zenithjoy.db_view_prefs(org_id);

-- ==================== 5. db_audit —— 建表/删表/还原的审计流水 ====================

CREATE TABLE IF NOT EXISTS zenithjoy.db_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  table_id    UUID,
  member_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  -- 只记 id 与动作，不记表名/字段名/单元格值正文（INV-5 日志脱敏同口径）
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_audit_org ON zenithjoy.db_audit(org_id, created_at DESC);

-- ==================== 6. G1 段② —— 旧 field_definitions 加 tenant_id ============
--
-- 口径照抄 works 家族的 20260428_132000_unify_tenant_isolation.sql：加 UUID 列 + 外键 +
-- 索引 + 回填。**不叫 org_id**：这张表归 works 家族，由 tenantContext/tenantId 过滤，
-- 列名与家族分叉的话中间件挂上去也过滤不到（合同判定点登记表选项 B）。
-- 两表并存不合并已由 INV-10 decision 正式消解，不是待还的技术债。

ALTER TABLE zenithjoy.field_definitions
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_definitions_tenant_id_fkey') THEN
    ALTER TABLE zenithjoy.field_definitions
      ADD CONSTRAINT field_definitions_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_field_definitions_tenant ON zenithjoy.field_definitions(tenant_id);

-- 回填：这张表建于多租户之前，历史行没有任何归属线索（无 owner_id / 无 created_by），
-- 唯一确定性的选择是挂到最早那家租户（按 created_at, id 排序，可重放）。
-- 生产库上该表长期为空，此语句实际是给"老库有零星测试行"的场景兜底。
UPDATE zenithjoy.field_definitions f
   SET tenant_id = (SELECT t.id FROM zenithjoy.tenants t ORDER BY t.created_at ASC, t.id ASC LIMIT 1)
 WHERE f.tenant_id IS NULL
   AND EXISTS (SELECT 1 FROM zenithjoy.tenants);

COMMIT;
