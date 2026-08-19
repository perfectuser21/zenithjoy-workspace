-- apps/api/db/migrations/20260819_210000_knowledge_entries_projection.sql
-- Line11 员工知识中枢 路① 第一刀 —— zenithjoy 侧只读投影表
--
-- SSOT 单向：经验正文的唯一权威是 Cecelia 账本 public.learnings，本表是它的**只读投影**。
-- zenithjoy 侧代码只许 SELECT；一旦这里出现 INSERT/UPDATE/DELETE，同一条经验就有了两个
-- 可写副本，问答与注入链路读到哪一份取决于时序，属于必须回滚的一类。
-- INV-5 用源码级 grep + 端点级断言（GET 200 / POST 404|405）双向钉住这一点。
--
-- DDL 幂等：CI 每次 for 循环重放全部 migration，非幂等语句会在第二次执行时炸掉整条链。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.knowledge_entries_projection (
  entry_id      uuid PRIMARY KEY,
  org_id        uuid NOT NULL,
  title         text NOT NULL DEFAULT '',
  evidence_url  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  synced_at     timestamptz NOT NULL DEFAULT now()
);

-- org_id NOT NULL 是跨企业隔离的底线：允许 NULL 就等于允许一条"不属于任何企业"的经验，
-- 而按组织过滤的读端会把它对所有人隐藏或对所有人暴露，两种都不可接受。
ALTER TABLE zenithjoy.knowledge_entries_projection ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_projection_org
  ON zenithjoy.knowledge_entries_projection (org_id, created_at DESC);

COMMENT ON TABLE zenithjoy.knowledge_entries_projection IS
  '经验条目只读投影（SSOT = cecelia public.learnings）；zenithjoy 侧只读不写';
