-- Line04 客服工作汇总 — 口径 + work_duration + mode 锚定种子（smoke / dod / draft 三处唯一来源 SSOT）
-- 用法：psql "$DATABASE_URL" -v RUN=<唯一标记> -f seed-stats.sql
--   :'RUN'        → 该客服微信号身份章（live 卡），psql 自动加引号
--   :'RUN'||'-dry'→ 同一轮的演练卡（auto_agent_enabled=false → mode=dryrun）
--
-- 锚定到「北京今天」固定 wall-clock（09:00 首条 → 09:30 末条），与运行时刻无关，
-- 绝不跨北京午夜（防 CI 在 00:xx 跑时口径漂）。所有 created_at 用 Asia/Shanghai 落 timestamptz。
--
-- 钉死预期（draft / dod / smoke 三处断言必须一致）：
--   received_count=5  reply_count=3  served_customers=2  work_duration_minutes=30
--   RUN 卡 mode='live'（auto_agent_enabled=true）/ RUN-dry 卡 mode='dryrun'（false）

-- ① 两个客服配置行：live（真发）+ dry（演练）。persona NOT NULL → 空对象占位。
INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona, auto_agent_enabled)
VALUES (:'RUN', '{}'::jsonb, true),
       (:'RUN' || '-dry', '{}'::jsonb, false)
ON CONFLICT (wechat_id) DO UPDATE SET auto_agent_enabled = EXCLUDED.auto_agent_enabled;

-- ② live 卡消息：5 in（c1×3 + c2×2）+ 3 out（c1×3）；首条 09:00、末条 09:30 → 时长 30 分钟
INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
SELECT 't-stats', v.contact, v.role, v.text, :'RUN',
       ((now() AT TIME ZONE 'Asia/Shanghai')::date + v.t) AT TIME ZONE 'Asia/Shanghai'
FROM (VALUES
  ('c1', 'in',  'i1', time '09:00'),
  ('c1', 'in',  'i2', time '09:10'),
  ('c1', 'in',  'i3', time '09:20'),
  ('c2', 'in',  'i4', time '09:05'),
  ('c2', 'in',  'i5', time '09:15'),
  ('c1', 'out', 'o1', time '09:25'),
  ('c1', 'out', 'o2', time '09:28'),
  ('c1', 'out', 'o3', time '09:30')
) AS v(contact, role, text, t);

-- ③ dry 卡：1 条 in（仅用于校验 mode=dryrun，不影响 live 卡口径）
INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
VALUES ('t-stats', 'cd', 'in', 'x', :'RUN' || '-dry',
        ((now() AT TIME ZONE 'Asia/Shanghai')::date + time '09:00') AT TIME ZONE 'Asia/Shanghai');
