-- user_profiles: 画像诊断（Path 1 Step 3）
-- 3 字段：行业 / 受众 / 风格
CREATE TABLE IF NOT EXISTS zenithjoy.user_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL UNIQUE,  -- better-auth user.id
  industry    TEXT NOT NULL,
  audience    TEXT NOT NULL,
  style       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
