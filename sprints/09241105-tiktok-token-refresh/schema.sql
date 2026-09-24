-- TikTok OAuth 令牌存放（复用 Meta 的 D1 库 zenithjoy-meta-publish）
--
-- 为什么必须落库而不是只读环境变量：
-- TikTok access token 只活 24 小时，而 Worker 的环境变量是只读的，
-- 刷新出来的新票无处安放。没有这张表，就只能每天人工重新授权一次，
-- TikTok 发布也就无法无人值守地运行。
--
-- 单行表（id 恒为 'default'）：本桥只服务一个 TikTok 账号。
-- 将来要支持多账号，把 id 换成 open_id 即可，无需改调用方。
CREATE TABLE IF NOT EXISTS tiktok_oauth_tokens (
  id            TEXT PRIMARY KEY,   -- 恒为 'default'
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,      -- TikTok 会轮换，每次刷新后必须回写
  expires_at    TEXT NOT NULL,      -- access_token 到期时刻（ISO8601）
  updated_at    TEXT NOT NULL
);
