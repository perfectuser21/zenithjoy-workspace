-- Migration: 为 zenithjoy.user_clip_settings 新增用户级 OAuth 绑定列
-- Date: 2026-05-22
-- Branch: cp-0522-clips-output-binding

ALTER TABLE zenithjoy.user_clip_settings
  ADD COLUMN IF NOT EXISTS notion_token            TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_token       TEXT,
  ADD COLUMN IF NOT EXISTS feishu_refresh_token    TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_id          TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_name        TEXT,
  ADD COLUMN IF NOT EXISTS feishu_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN zenithjoy.user_clip_settings.notion_token
  IS 'Notion Integration Token (用户自填，明文存储)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_user_token
  IS 'Feishu user_access_token (OAuth, ~12h TTL)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_refresh_token
  IS 'Feishu refresh_token (~30d TTL)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_user_id
  IS 'Feishu open_id (用户标识)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_user_name
  IS 'Feishu 用户名（前端展示）';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_token_expires_at
  IS 'Feishu user_access_token 过期时间（提前5分钟刷新）';
