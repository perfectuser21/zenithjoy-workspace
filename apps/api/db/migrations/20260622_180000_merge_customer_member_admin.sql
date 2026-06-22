-- #816 结构性去重：会员管理 ⊕ 客户管理 合并为一个「客户管理」
--
-- 账号模型统一到「老的 better-auth 注册用户 + tenant_members」，废掉新造的
-- zenithjoy.tenant_sub_accounts。客服-PC 绑定（service_agents）改绑真实成员。
--
-- 变更：
--   1. service_agents 增列 member_user_id（存 better-auth user.id = tenant_members.feishu_user_id）
--   2. service_agents 去掉对 tenant_sub_accounts 的 FK（account_id），改用 member_user_id
--   3. DROP TABLE zenithjoy.tenant_sub_accounts（生产为空，DROP 前断言行数=0）
--
-- 幂等：全部 IF EXISTS / IF NOT EXISTS / 条件守卫，可重入。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ==================== 1. service_agents 改绑真实成员 ====================

-- 新增成员标识列（better-auth user.id），允许 NULL 以便先建列再回填
ALTER TABLE zenithjoy.service_agents
  ADD COLUMN IF NOT EXISTS member_user_id text;

-- 老数据回填：把指向 tenant_sub_accounts 的绑定按 email 对齐到注册用户 id。
-- 仅当老表还在时执行（生产为空 → 无行可填，纯防御）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'zenithjoy' AND table_name = 'tenant_sub_accounts'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'zenithjoy' AND table_name = 'service_agents'
       AND column_name = 'account_id'
  ) THEN
    UPDATE zenithjoy.service_agents sa
       SET member_user_id = u.id
      FROM zenithjoy.tenant_sub_accounts tsa
      JOIN "user" u ON lower(u.email) = lower(tsa.email)
     WHERE sa.account_id = tsa.id
       AND sa.member_user_id IS NULL;
  END IF;
END $$;

-- 去掉旧的 account_id 列（连同其对 tenant_sub_accounts 的 FK）
ALTER TABLE zenithjoy.service_agents
  DROP COLUMN IF EXISTS account_id;

-- 成员维度的双唯一兜底（partial unique，仅未软删行）：1 成员只能绑 1 PC
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agents_member_active
  ON zenithjoy.service_agents(member_user_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN zenithjoy.service_agents.member_user_id
  IS '绑定的真实成员（better-auth user.id = tenant_members.feishu_user_id），替代已废弃的 account_id→tenant_sub_accounts';

-- ==================== 2. 废 tenant_sub_accounts ====================

-- 安全闸：生产应为空。非空则中止 migration，强制人工确认数据去向（不静默丢数据）。
DO $$
DECLARE
  cnt bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'zenithjoy' AND table_name = 'tenant_sub_accounts'
  ) THEN
    EXECUTE 'SELECT count(*) FROM zenithjoy.tenant_sub_accounts' INTO cnt;
    IF cnt > 0 THEN
      RAISE EXCEPTION 'tenant_sub_accounts 仍有 % 行数据，拒绝 DROP；请先迁移数据再重跑', cnt;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS zenithjoy.tenant_sub_accounts CASCADE;
