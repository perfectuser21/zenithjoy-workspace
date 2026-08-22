-- apps/api/db/migrations/20260822_002500_dm_perhour_interval_tune.sql
-- 主理人 0821 深夜拍板：dm_per_hour 5→20（原值是自拍保守值，卡住了重投产能：
-- 33/35 候选被 per-hour 闸限流），发送间隔 300-900s → 120-180s（对应"两三分钟发
-- 一条"，保留随机抖号不改成固定间隔）。
--
-- 幂等：ALTER COLUMN SET DEFAULT 可重复执行；UPDATE 只挑仍停在旧默认三元组
-- （5 / 300 / 900）的行——天然跳过已被手动 PUT /config 自定义过的租户。

ALTER TABLE zenithjoy.acquisition_config ALTER COLUMN dm_per_hour SET DEFAULT 20;
ALTER TABLE zenithjoy.acquisition_config ALTER COLUMN dm_interval_min_sec SET DEFAULT 120;
ALTER TABLE zenithjoy.acquisition_config ALTER COLUMN dm_interval_max_sec SET DEFAULT 180;

UPDATE zenithjoy.acquisition_config
   SET dm_per_hour = 20,
       dm_interval_min_sec = 120,
       dm_interval_max_sec = 180
 WHERE dm_per_hour = 5
   AND dm_interval_min_sec = 300
   AND dm_interval_max_sec = 900;
