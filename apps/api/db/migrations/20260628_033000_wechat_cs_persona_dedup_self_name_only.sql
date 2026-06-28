-- persona 单一 SSOT 收敛（消除「话术知识库」↔「客服机」两份重复）
--
-- 背景：每客服配置表 zenithjoy.wechat_cs_account_config.persona 此前由一键配置写入整份
-- persona（含硬编码 style 死值 address_style:'亲切' / tone:'友好专业' …），盖掉了全局
-- 话术库（wechat_cs_config）里运营精心配的人设 → 两边对不上。
--
-- 收敛后：每客服 persona **只保留 self_name**（人设名，per-operator 覆盖位）；style 的唯一
-- 真相来源 = 全局话术库。本迁移把存量行的 persona 收敛成 {self_name}，删掉历史 style 死值。
--
-- 不丢用户数据：运营真正编辑过的人设在全局话术库（未触碰）；每客服 style 本就是硬编码死值，
-- 删除无损失；self_name（运营在客服机填的人设名）完整保留。
--
-- 幂等：只更新「persona 去掉 self_name 后仍非空」的行（即还残留 style 字段的行）；
-- 收敛过的行再跑命中 0 行，安全可重入。

UPDATE zenithjoy.wechat_cs_account_config
   SET persona = jsonb_build_object('self_name', COALESCE(persona ->> 'self_name', '')),
       updated_at = now()
 WHERE persona IS NOT NULL
   AND jsonb_typeof(persona) = 'object'
   AND (persona - 'self_name') <> '{}'::jsonb;
