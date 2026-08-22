-- 路② 协同笔记/文档 第一刀 —— documents 富文本存储底座 + 可见成员集合表
--
-- 设计口径（合同 [ARTIFACT] / prep-prd Invariant 逐条）：
--   * org_id UUID NOT NULL：组织归属是硬约束，不是应用层约定（cross-tenant 六层隔离的地基）。
--   * content jsonb：ProseMirror/TipTap 文档 JSON（HTTP 保存路径写，服务端 CV 白名单剥非法节点后落库）。
--   * crdt_state bytea：Yjs 文档二进制状态（collab-ws 实时协同 apply 后落库；派生 doc 与 content 一致）。
--   * visibility 三档：'org' 组织可见 / 'members' 成员集合 / 'private' 仅自己。
--   * ai_retrieval_opt_out bool DEFAULT false：S4/S5 AI 读预留位（本刀不消费，仅建列）。
--   * 软删（deleted_at）：删文档只打 deleted_at，物理行保留，回收站可还原。
--   * document_members：members 档的可见成员集合（doc_id / member_id）。
--   * 全部 DDL 幂等（IF NOT EXISTS / DO $$ 守卫）：CI 会重放全部 migration。

BEGIN;

-- ==================== 1. documents —— 协同文档本体 ====================

CREATE TABLE IF NOT EXISTS zenithjoy.documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL,
  parent_id             UUID REFERENCES zenithjoy.documents(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL DEFAULT '未命名',
  owner_member_id       TEXT NOT NULL,
  -- 'org' = 组织可见；'members' = 成员集合；'private' = 仅自己。真访问控制，不是前端过滤。
  visibility            TEXT NOT NULL DEFAULT 'org',
  content               JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  crdt_state            BYTEA,
  -- S4/S5 AI 读预留位（本刀不消费）：文档主人可声明"不进 AI 检索"。
  ai_retrieval_opt_out  BOOLEAN NOT NULL DEFAULT false,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_visibility_chk') THEN
    ALTER TABLE zenithjoy.documents
      ADD CONSTRAINT documents_visibility_chk CHECK (visibility IN ('org', 'members', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_org ON zenithjoy.documents(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_org_live ON zenithjoy.documents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_parent ON zenithjoy.documents(parent_id);

-- ==================== 2. document_members —— members 档的可见成员集合 ====================

CREATE TABLE IF NOT EXISTS zenithjoy.document_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES zenithjoy.documents(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_members_uniq') THEN
    ALTER TABLE zenithjoy.document_members
      ADD CONSTRAINT document_members_uniq UNIQUE (doc_id, member_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_members_doc ON zenithjoy.document_members(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_members_member ON zenithjoy.document_members(member_id);

COMMIT;
