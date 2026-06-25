-- Line04 中台 CRM 地基 Track C — crm_customers 加「加微信时间」+ 身份概念（内部人员名册）
--
-- 外层客户表重做需要两件地基：
--   ① add_friend_time（加微信时间）：客户成为好友的时间。agent 扫好友 ingest 时上报（可空，存量为 NULL）。
--      与 last_seen_at（最后观测）/ last_contact_at（最后联系）区分：add_friend_time 是「关系起点」，前两者是「最近活跃」。
--   ② 身份三态：客户·接管 / 黑名单 / 内部人员。前两态由 wechat_cs_account_config.blacklist + takeover_mode 实时算
--      （managed = contact ∉ blacklist）；本迁移落地第三态「内部人员」——徐啸 / 于瑾 / 苏彦卿 这类自己人，
--      出现在客服机好友里时应被识别为内部人员，排除出「客户接管」（managed 强制 false，AI 不当客户回他），
--      且将来当通知接收人（wechat_id 备用）。
--
-- 内部人员名册做成独立表 crm_internal_staff（全局，非租户隔离）：他们是 ZenithJoy 自己人，
-- 同一拨人可能出现在多个租户的客服机好友里，名字（昵称）即身份 key（与 contact / blacklist 同字面）。
-- 身份判定在名册聚合层（buildCustomerRoster）按 contact ∈ internal_staff.name 命中。
--
-- 幂等可重入：ALTER ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / seed ON CONFLICT DO NOTHING。

-- ① 加微信时间（关系起点；agent 扫好友上报，可空）
ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS add_friend_time timestamptz;

COMMENT ON COLUMN zenithjoy.crm_customers.add_friend_time IS
  '加微信时间（成为好友的时间，关系起点）；agent 扫好友 ingest 上报，可空，存量为 NULL。区别于 last_seen_at/last_contact_at（最近活跃）。';

-- ② 内部人员名册（身份三态之「内部人员」）：全局，名字=身份 key（与 contact/blacklist 同字面）。
CREATE TABLE IF NOT EXISTS zenithjoy.crm_internal_staff (
  id         BIGSERIAL PRIMARY KEY,
  name       text NOT NULL,                  -- 内部人员昵称（身份 key，与 crm_customers.contact 同字面命中）
  wechat_id  text,                           -- 微信号（将来当通知接收人备用，可空）
  note       text,                           -- 备注（如部门/角色）
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

COMMENT ON TABLE zenithjoy.crm_internal_staff IS
  'Line04 CRM 身份三态之「内部人员」名册（ZenithJoy 自己人，全局非租户隔离）；contact 命中其 name → identity=internal，排除出客户接管(managed=false)，将来当通知接收人';

-- seed 内部人员：徐啸 / 于瑾 / 苏彦卿（用户拍板 2026-06-25）。幂等：按 name 冲突不重复插。
INSERT INTO zenithjoy.crm_internal_staff (name, note) VALUES
  ('徐啸',   '内部人员'),
  ('于瑾',   '内部人员'),
  ('苏彦卿', '内部人员')
ON CONFLICT (name) DO NOTHING;
