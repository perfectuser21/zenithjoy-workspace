-- apps/api/db/migrations/20260710_150000_collect_videos_composite_pk.sql
-- 多视频协议闭环 PR1-2（Brain task 4fad361c）：
-- 1. 主键 video_id → (task_id, video_id)：旧全局唯一键会让同一抖音视频被两个任务命中时互相覆盖。
--    全库无 FK 引用本表（20260702 migration 是唯一 DDL），无数据清洗前置（旧单列 PK 保证无跨 task 重复）。
-- 2. comments_reported_at：Stage2 评论回报完成标记（NULL=未完成），pending-collect-tasks 只下发未完成视频，
--    settleCollectTask 据 count(comments_reported_at) 结算终态。
-- 生产落地：hk-vps + mmv 两台独立 postgres 各跑一遍（死规则）。

ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS comments_reported_at timestamptz;

DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO pk_cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
   WHERE n.nspname = 'zenithjoy' AND t.relname = 'acquisition_collect_videos' AND c.contype = 'p';

  IF pk_cols IS DISTINCT FROM 'task_id,video_id' THEN
    ALTER TABLE zenithjoy.acquisition_collect_videos DROP CONSTRAINT IF EXISTS acquisition_collect_videos_pkey;
    ALTER TABLE zenithjoy.acquisition_collect_videos ADD PRIMARY KEY (task_id, video_id);
  END IF;
END $$;

COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.comments_reported_at IS
  'Stage2 评论回报完成时间（NULL=未完成）；pending-collect-tasks 只下发 NULL 的视频';
