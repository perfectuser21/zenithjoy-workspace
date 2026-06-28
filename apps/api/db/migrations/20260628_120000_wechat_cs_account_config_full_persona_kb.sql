-- IA 重设计刀1：每号承载【完整 persona + business_kb】（消除「话术库」全局 ↔「客服机」每号 重复）
--
-- 背景：PR#940 把 persona 折中成「全局 style + 每号 self_name」，用户在两个页面都看到人设、语义
-- 矛盾。本刀反转：每号配置表 zenithjoy.wechat_cs_account_config 独立承载完整 persona + 每号 business_kb，
-- 全局表 zenithjoy.wechat_cs_config 标 deprecated（一期不读不删，二期删；见 design doc §4/§5）。
--
-- 迁移做三件事（纯 .sql，避开 ts-node migration 部署坑；全部幂等可重跑）：
--   1) 加 business_kb JSONB 列（IF NOT EXISTS）
--   2) persona 回填：把全局 persona 的 style 灌到每个「还只剩 self_name（被 0628_033000 收敛过）」的号；
--      self_name 用 COALESCE 保留该号已配的人设名，不被全局覆盖
--   3) business_kb 回填：把全局 business_kb 灌到每个空 business_kb 的号作为初值
--
-- 幂等保证：列加 IF NOT EXISTS；persona 回填带 collapse-guard（(persona-'self_name')='{}' 才填，
--   填过有 style → 第二次跑命中 0 行）；business_kb 回填只填空值行。重复跑不丢已配人设、不覆盖运营编辑。

-- ① business_kb 列
ALTER TABLE zenithjoy.wechat_cs_account_config
  ADD COLUMN IF NOT EXISTS business_kb JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ② persona 回填：全局 style 灌进「只剩 self_name」的号；COALESCE 保留已配 self_name（不丢人设名）
UPDATE zenithjoy.wechat_cs_account_config c
   SET persona = jsonb_set(
         COALESCE((SELECT p.value FROM zenithjoy.wechat_cs_config p WHERE p.key = 'persona'), '{}'::jsonb),
         '{self_name}',
         to_jsonb(COALESCE(
           NULLIF(c.persona ->> 'self_name', ''),
           (SELECT p.value ->> 'self_name' FROM zenithjoy.wechat_cs_config p WHERE p.key = 'persona'),
           ''
         ))
       ),
       updated_at = now()
 WHERE EXISTS (SELECT 1 FROM zenithjoy.wechat_cs_config p WHERE p.key = 'persona')
   AND jsonb_typeof(c.persona) = 'object'
   -- collapse-guard：只填「persona 去掉 self_name 后为空」的行（= 还没 style）→ 幂等，第二次跑命中 0 行
   AND (c.persona - 'self_name') = '{}'::jsonb;

-- ③ business_kb 回填：全局 business_kb 灌进每个空 business_kb 的号
UPDATE zenithjoy.wechat_cs_account_config c
   SET business_kb = (SELECT b.value FROM zenithjoy.wechat_cs_config b WHERE b.key = 'business_kb'),
       updated_at = now()
 WHERE EXISTS (SELECT 1 FROM zenithjoy.wechat_cs_config b WHERE b.key = 'business_kb')
   AND (c.business_kb IS NULL OR c.business_kb = '{}'::jsonb);

-- ④ 全局表标 deprecated（一期保留作回落兜底，不读不删；二期删）
COMMENT ON TABLE zenithjoy.wechat_cs_config IS
  'DEPRECATED(2026-06-28 IA重设计刀1): persona/business_kb 已每号化到 wechat_cs_account_config；本表仅作回落兜底，二期删';
