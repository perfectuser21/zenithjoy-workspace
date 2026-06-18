-- apps/api/db/migrations/20260618_190000_acquisition_collect.sql
-- Path 2 Step4 — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环
--
-- 1. acquisition_collect_tasks  采集任务（7 态状态机 CHECK 约束 + error_code + 断点 checkpoint + 计数）
-- 2. acquisition_leads          采集到的抖音号（(tenant_id,sec_uid) 去重 + 昵称弱去重 + 残缺标记 + 待补写飞书）
-- 3. tenant_feishu_bindings     加 enterprise_doc_token（企业信息 docx）+ updated_at
--
-- 状态值约定：pending/running/cancelling/cancelled/done/partial/failed（7 态）
-- error_code 字段统一承载失败/部分原因：
--   partial → video_insufficient / comments_closed / zero_comment
--   failed  → DOUYIN_RISK / DOUYIN_CAPTCHA / DOUYIN_NOT_LOGGED_IN（report body 传入，字面落库区分原因）

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. 采集任务表（7 态 CHECK 约束）─────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_collect_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  keywords        jsonb NOT NULL DEFAULT '[]'::jsonb,
  source          text NOT NULL DEFAULT 'ai',          -- ai | manual | seed
  degraded        boolean NOT NULL DEFAULT false,       -- DeepSeek 降级兜底标记
  status          text NOT NULL DEFAULT 'pending',
  error_code      text,                                 -- partial/failed 原因（字面落库）
  checkpoint      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- 断点续抓位点 {keyword_idx,video_idx,scroll_offset}
  video_count     integer NOT NULL DEFAULT 0,
  lead_count_raw  integer NOT NULL DEFAULT 0,            -- 去重前累计评论者数
  agent_id        text,
  started_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_acq_collect_status CHECK (
    status IN ('pending', 'running', 'cancelling', 'cancelled', 'done', 'partial', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_acq_collect_tenant   ON zenithjoy.acquisition_collect_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_acq_collect_status   ON zenithjoy.acquisition_collect_tasks(status);

COMMENT ON TABLE zenithjoy.acquisition_collect_tasks IS
  'Path2 Step4 采集任务 — 7 态状态机(pending→running→cancelling→cancelled/done/partial/failed) + 断点 checkpoint + error_code 区分原因';

-- ── 2. 采集 leads 表（(tenant_id,sec_uid) 去重 + 昵称弱去重 + 残缺/待补写飞书）──
CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  collect_task_id    uuid REFERENCES zenithjoy.acquisition_collect_tasks(id) ON DELETE SET NULL,
  sec_uid            text,                              -- NULL = sec_uid 解析不出（残缺/待核）
  nickname           text NOT NULL,
  profile_url        text,                              -- 残缺号置空（无主页链接）
  partial            boolean NOT NULL DEFAULT false,    -- 残缺/待核标记
  source_video_ids   jsonb NOT NULL DEFAULT '[]'::jsonb, -- 命中的来源 video_id 列表（重复仅累加）
  feishu_write_status text NOT NULL DEFAULT 'pending',  -- success | pending(待补写飞书) | failed
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 去重在 service 层 dedupCommenters 处理（(tenant_id,sec_uid) + 昵称弱去重）；索引仅供查询加速
CREATE INDEX IF NOT EXISTS idx_acq_leads_tenant_sec ON zenithjoy.acquisition_leads(tenant_id, sec_uid);
CREATE INDEX IF NOT EXISTS idx_acq_leads_task       ON zenithjoy.acquisition_leads(collect_task_id);

COMMENT ON TABLE zenithjoy.acquisition_leads IS
  'Path2 Step4 采集抖音号 — (tenant_id,sec_uid) 去重 / sec_uid 缺失按 (tenant_id,nickname) 弱去重 + 残缺标记 + feishu_write_status 待补写飞书';

-- ── 3. tenant_feishu_bindings 加企业信息文档 token + updated_at ──────
ALTER TABLE zenithjoy.tenant_feishu_bindings
  ADD COLUMN IF NOT EXISTS enterprise_doc_token text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN zenithjoy.tenant_feishu_bindings.enterprise_doc_token IS
  'Path2 Step4 企业信息飞书文档(docx) token — 绑飞书时自动建，expand 读其纯文本扩词';
