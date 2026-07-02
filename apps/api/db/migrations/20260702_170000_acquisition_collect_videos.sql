-- apps/api/db/migrations/20260702_170000_acquisition_collect_videos.sql
-- Line02 获客工作台 IA 重设计 — 视频维度表（当前完全不存在按视频维度的表，
-- 只有 acquisition_leads.source_video_ids 数组）。
--
-- title/thumbnail_url/publish_date 由 agent 端视频元数据抓取回填（暂未接入，先留空占位，
-- 前端对空值降级只显示视频链接）；comment_count 由 /collect/report 每次上报累加。

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_collect_videos (
  video_id       text PRIMARY KEY,
  task_id        uuid NOT NULL REFERENCES zenithjoy.acquisition_collect_tasks(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  title          text,
  thumbnail_url  text,
  publish_date   timestamptz,
  comment_count  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acq_collect_videos_task   ON zenithjoy.acquisition_collect_videos(task_id);
CREATE INDEX IF NOT EXISTS idx_acq_collect_videos_tenant ON zenithjoy.acquisition_collect_videos(tenant_id);

COMMENT ON TABLE zenithjoy.acquisition_collect_videos IS
  'Line02 获客工作台 IA 重设计 — 采集任务下的视频维度记录（video_id 唯一，title/thumbnail_url/publish_date 待 agent 端抓取回填）';
