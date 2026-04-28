-- 技能注册表（Skill Registry）
-- skill = 一个具体可执行的发布/采集能力，对应 Agent 上的一个脚本
CREATE TABLE IF NOT EXISTS zenithjoy.skills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,          -- 唯一标识符，如 kuaishou_image_publish
  platform     text NOT NULL,                 -- 平台 code，对应 zenithjoy.platforms.code
  category     text NOT NULL DEFAULT 'publish', -- publish | data_collection | account_mgmt
  name         text NOT NULL,                 -- 人类可读名称，如 "快手图文发布"
  content_type text,                          -- image | video | article | idea | null
  is_dryrun    boolean NOT NULL DEFAULT false,
  script_path  text NOT NULL,                 -- Agent 上相对路径，如 publishers/kuaishou-publisher/publish-kuaishou-image.cjs
  description  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skills_platform ON zenithjoy.skills(platform);
CREATE INDEX IF NOT EXISTS idx_skills_category ON zenithjoy.skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_active ON zenithjoy.skills(active) WHERE active = true;

COMMENT ON TABLE zenithjoy.skills IS 'Skill Registry — 记录 Agent 可执行的全部技能（脚本）';

-- 每个 Agent 的技能状态（Agent 在 hello/heartbeat 时上报）
CREATE TABLE IF NOT EXISTS zenithjoy.agent_skill_status (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     text NOT NULL,                 -- 对应 zenithjoy.agents.agent_id
  skill_slug   text NOT NULL REFERENCES zenithjoy.skills(slug) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'unknown', -- ready | login_expired | unavailable | unknown
  last_check   timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, skill_slug),
  CONSTRAINT chk_skill_status CHECK (status IN ('ready', 'login_expired', 'unavailable', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_status_agent ON zenithjoy.agent_skill_status(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_status_slug ON zenithjoy.agent_skill_status(skill_slug);

COMMENT ON TABLE zenithjoy.agent_skill_status IS '每台 Agent 各 Skill 的实时状态（登录/可用/不可用）';
