-- Line04 CRM 重做 迁移 A — wechat_cs_account_config 加 blacklist + takeover_mode（黑名单主模型）
--
-- 黑名单主模型：默认全接管 + 黑名单排除。新接入客服机 takeover_mode='blacklist'
-- （should_reply(sender)=sender∉blacklist）；存量客服机必须保持原行为零误发，故落 'whitelist'。
--
-- ⚠️ 误发风险核心（lead 拍板，不可改）：
-- 「存量客服机一升级就从『只接管白名单几人』突变成『接管除黑名单外的全部人』」= 语义反转误发。
-- 为根除：分两步——
--   ① ADD COLUMN ... DEFAULT 'whitelist' → **所有存量行立即落 'whitelist'**（保原 should_reply∈whitelist 行为）。
--   ② ALTER COLUMN ... SET DEFAULT 'blacklist' → 此后**新接入**客服机才默认主模型 blacklist（全接管）。
-- 这样存量与新接入物理分流，不靠时间戳/启发式猜测，重跑也幂等（IF NOT EXISTS + 固定 DEFAULT）。
-- whitelist 字段保留不删（迁移期兼容；blacklist 模式下 should_reply 不读 whitelist）。

-- ① blacklist 字段：排除名单（昵称数组，与 should_reply / contact 同字面）。
ALTER TABLE zenithjoy.wechat_cs_account_config
  ADD COLUMN IF NOT EXISTS blacklist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ② takeover_mode：加列时 DEFAULT 'whitelist' → 存量行全部落 whitelist（零误发）。
ALTER TABLE zenithjoy.wechat_cs_account_config
  ADD COLUMN IF NOT EXISTS takeover_mode text NOT NULL DEFAULT 'whitelist';

-- 加列后把列默认改为 'blacklist'：此后新插入（新接入客服机）默认主模型 blacklist。
-- 已存在的行不受 SET DEFAULT 影响（保持 ① 落的 'whitelist'）。重复跑等价（默认值固定为 blacklist）。
ALTER TABLE zenithjoy.wechat_cs_account_config
  ALTER COLUMN takeover_mode SET DEFAULT 'blacklist';

-- CHECK 约束单独加（IF NOT EXISTS 不支持约束名，先 DROP 再 ADD 保幂等）。
ALTER TABLE zenithjoy.wechat_cs_account_config
  DROP CONSTRAINT IF EXISTS wechat_cs_account_config_takeover_mode_check;
ALTER TABLE zenithjoy.wechat_cs_account_config
  ADD CONSTRAINT wechat_cs_account_config_takeover_mode_check
    CHECK (takeover_mode IN ('blacklist','whitelist'));

COMMENT ON COLUMN zenithjoy.wechat_cs_account_config.blacklist IS
  'Line04 CRM 黑名单主模型：排除名单（昵称数组，与 should_reply / contact 同字面）。blacklist 模式下 should_reply(sender)=sender∉blacklist';
COMMENT ON COLUMN zenithjoy.wechat_cs_account_config.takeover_mode IS
  'blacklist(主，默认全接管)|whitelist(兼容/小众，仅接管名单内)。存量客服机迁移落 whitelist 保原行为零误发；新接入默认 blacklist';
