-- apps/api/db/migrations/20260822_094500_add_tree_snapshot_device_to_dm_outreach_log.sql
-- AI on-call 横切件 · 刀1（0822 主理人拍板，line02·横切件池）：
-- 失败现场第三件（无障碍树快照）+ 设备版本三件套落正表。
--
-- 前台包名+诊断行（20260821_123000）翻过两次错判，但要让 AI 能"指认元素"
--（刀2 定位求助）、让周报能"按机型×版本聚类"（刀3 固化发版），还差这四列。
-- 快照 30 天保留期由 /dm-outreach-result 路由惰性清扫（只清快照重列，
-- 其余现场字段永久保留）；设备三件按行落库——机队版本随时间漂移，行内不带
-- 版本就没法事后对账。
--
-- 幂等：ADD COLUMN IF NOT EXISTS。

ALTER TABLE zenithjoy.dm_outreach_log
  ADD COLUMN IF NOT EXISTS ui_tree_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS device_model     TEXT,
  ADD COLUMN IF NOT EXISTS os_version       TEXT,
  ADD COLUMN IF NOT EXISTS app_version      TEXT;

COMMENT ON COLUMN zenithjoy.dm_outreach_log.ui_tree_snapshot IS
  '失败那一刻的无障碍树快照（agent 端 64KB/30层/800节点截断，服务端二次截断 65536 字符；30 天后被路由惰性清扫置 NULL）';
COMMENT ON COLUMN zenithjoy.dm_outreach_log.device_model IS
  '上报设备 Build.MANUFACTURER + Build.MODEL（周报按机型聚类的分组键）';
COMMENT ON COLUMN zenithjoy.dm_outreach_log.os_version IS
  '上报设备 Android 版本（Build.VERSION.RELEASE + API level）';
COMMENT ON COLUMN zenithjoy.dm_outreach_log.app_version IS
  '上报时 agent 的 BuildConfig.VERSION_NAME（机队版本漂移对账用）';
