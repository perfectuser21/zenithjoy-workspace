-- 对话式创建 Skill — 后台长跑改造字段扩展
-- sprint_dir: sprints/07101942-skill-create-longrun
-- task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
--
-- 为 zenithjoy.skill_drafts 表新增三个字段，支持异步长跑生成：
--   pending_question  — AI 生成途中需要员工决策时的问题文本
--   result_json       — 终态结果（done: zip_path；error: error_message）
--   callback_token    — 子进程调用内部回调端点时的校验 token（单次绑定）
--
-- 兼容性：添加字段时设默认值 NULL，旧数据查询 GET /:id 正常返回（N-07）。
-- migration 文件幂等：使用 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

ALTER TABLE zenithjoy.skill_drafts
  ADD COLUMN IF NOT EXISTS pending_question TEXT,
  ADD COLUMN IF NOT EXISTS result_json      JSONB,
  ADD COLUMN IF NOT EXISTS callback_token   UUID;

COMMENT ON COLUMN zenithjoy.skill_drafts.pending_question IS
  'AI 生成途中需要员工决策时的问题文本（status=needs_input 时非空）';
COMMENT ON COLUMN zenithjoy.skill_drafts.result_json IS
  '终态结果 JSON：done 时含 zip_path，error 时含 error_message';
COMMENT ON COLUMN zenithjoy.skill_drafts.callback_token IS
  '子进程调用 POST /internal/skill-drafts/:id/callback 的校验 UUID（单次绑定，使用后清空）';
