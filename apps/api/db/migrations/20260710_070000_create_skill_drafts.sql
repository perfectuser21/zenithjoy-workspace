-- 对话式创建 Skill — skill_drafts 表
-- sprint_dir: sprints/07091721-conversational-skill-creation
--
-- 员工在「创建 Skill」Tab 里与 AI 多轮对话产出一个 skill 草稿。每个草稿一条记录，
-- messages_json 存整段对话历史（用户消息 + AI 回复），status 是状态机
-- （chatting → generating → done | error），job_id 是自动提交评测后拿到的评测任务 ID。
--
-- status 枚举不用 CHECK 约束写死到 DB 层——状态机权威定义在应用层
-- apps/api/src/services/skillDraftStateMachine.ts，DB 只存文本，避免两边定义漂移。

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS zenithjoy.skill_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     text,
  messages_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'chatting',
  job_id         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_drafts_status ON zenithjoy.skill_drafts(status);

COMMENT ON TABLE zenithjoy.skill_drafts IS
  '对话式创建 Skill 草稿（Staff Tools Hub）—— messages_json 存对话历史，status 状态机 chatting→generating→done|error';
COMMENT ON COLUMN zenithjoy.skill_drafts.session_id IS
  'claude -p --resume 用的会话 ID，用于 mmv 上 SSH 转发续接同一段对话';
COMMENT ON COLUMN zenithjoy.skill_drafts.job_id IS
  '生成完成后自动提交到 /api/staff/skill-eval/upload 拿到的评测 job_id';
