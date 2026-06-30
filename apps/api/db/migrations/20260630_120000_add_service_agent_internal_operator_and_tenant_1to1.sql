-- Line04 账号身份层：service_agents 加「内部人员」列 + 1 email↔1 微信 1:1 绑定唯一约束（防串台）
--
-- 背景（用户拍板，Line04 第二刀地基）：
--   "一个 email 账号绑定一个微信，要不然就串台，将来加上 CRM 就串台，很尴尬。所以我只需要有个地方
--    写上这个号真正的内部人员是谁，有个地方写着，每次就清楚了。"
--
-- 两件事：
--  1. internal_operator —— 记录「这个客服微信号背后真正的内部人员是谁」（人名/标识）。
--     与已有三列分工：real_wechat_id=真实微信号(SSOT,perfect-xx)、wechat_display_name=微信昵称(默忆)、
--     wxid_internal=内部 wxid；internal_operator = 背后那个真人（苏彦卿/于瑾），便于对账、防绑错号。
--     运营在中台「我的客服机」页填写，可编辑可查。
--
--  2. uq_service_agents_tenant_active —— 一个租户（= 一个 email/license 账号）只能有一行 active 绑定
--     （= 一个微信号）。这是「1 email↔1 微信」的 DB 层兜底；应用层 setupCSByMachine 在写入前先查同租户
--     已绑别的机器 → 抛 TENANT_ALREADY_BOUND 友好告警（绝不静默建第二行）。两层防串台。
--
-- 纯 ALTER ADD 列，不动 PK/外键，无数据迁移。唯一索引用 DO 块保护：若存量库已存在「同租户多绑定」
-- （历史脏数据 / 共享 CI 库多 smoke 残留），跳过索引创建 + RAISE WARNING（不让发版红），应用层仍 enforce。

ALTER TABLE zenithjoy.service_agents
  ADD COLUMN IF NOT EXISTS internal_operator text;

COMMENT ON COLUMN zenithjoy.service_agents.internal_operator IS
  '内部人员：这个客服微信号背后真正的内部人员是谁（人名/标识，如 苏彦卿/于瑾）。运营在中台手填，可编辑可查，便于对账防绑错号。≠ real_wechat_id(微信号) ≠ wechat_display_name(昵称) ≠ persona.self_name(AI 人设名)。';

-- 1 email↔1 微信 1:1：同一租户（= 同 email/license 账号）至多一行 active 绑定。
-- 存量已有违例 → 跳过创建（RAISE WARNING），不阻塞发版；应用层 setupCSByMachine 仍拦第二台机器。
DO $$
BEGIN
  IF EXISTS (
    SELECT tenant_id
      FROM zenithjoy.service_agents
     WHERE deleted_at IS NULL
     GROUP BY tenant_id
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING '[migration] service_agents 存在同租户多 active 绑定，跳过 uq_service_agents_tenant_active 创建（应用层仍 enforce 1:1）；请人工清理后手建唯一索引。';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agents_tenant_active
      ON zenithjoy.service_agents (tenant_id)
      WHERE deleted_at IS NULL;
  END IF;
END $$;
