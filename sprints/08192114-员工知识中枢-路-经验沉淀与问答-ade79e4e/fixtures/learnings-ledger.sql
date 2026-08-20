-- Cecelia 账本 public.learnings 建表 fixture（windows_cloud runner 缺表时用）
--
-- 来源：`pg_dump -s -t public.learnings` 从真 cecelia 账本导出（不是手写猜列）。
-- 列名、类型、默认值、NOT NULL、两条 CHECK 约束全部逐字沿用 dump 输出 ——
-- 猜列的后果是「测试里写得进去、真账本写不进去」，那种绿比红更坏。
--
-- 相对 dump 原文的三处删改，各自都是"runner 上跑不了"而非"我觉得不重要"：
--   1. embedding public.vector(1536)  → 改为按 pgvector 是否可用**条件补列**。
--      windows-latest 的 PostgreSQL 不带 pgvector，无条件建列会让整段 fixture 炸掉。
--      本 sprint 零 embedding（向量化属 S2），补不上也不影响录入/读端。
--   2. learnings_embedding_idx（hnsw）→ 同上，随 pgvector 条件建。
--   3. FK → public.memory_stream / public.tasks → 删。fixture 只建这一张表，
--      那两张表在 runner 上不存在，带着 FK 会直接建表失败。自引用的
--      parent_id / parent_learning_id 两条 FK 保留（指向本表，建得起来）。
--
-- 这张表属 cecelia repo，不在本仓 migrations 里；本 fixture 只在 runner 缺表时兜底，
-- 列形状的真验由第一段 bash 在**真 cecelia 库**上跑完成（见合同「未覆盖真实链路清单」#4）。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.learnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    category character varying(50),
    trigger_event character varying(100),
    content text,
    strategy_adjustments jsonb,
    applied boolean DEFAULT false,
    applied_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    metadata jsonb,
    effectiveness_score double precision,
    rollback_needed boolean DEFAULT false,
    effectiveness_evaluated_at timestamp with time zone,
    trigger_conditions jsonb,
    quality_score double precision,
    trigger_source character varying(50),
    triggered_at timestamp without time zone,
    time_window_minutes integer,
    frequency_count integer,
    frequency_window_hours integer,
    content_hash character varying(64),
    version integer DEFAULT 1,
    parent_id uuid,
    is_latest boolean DEFAULT true,
    digested boolean DEFAULT false,
    archived boolean DEFAULT false,
    summary character varying(200) DEFAULT NULL::character varying,
    source_memory_id uuid,
    root_cause_hash character varying(64),
    occurrence_count integer DEFAULT 1,
    learning_type character varying(50),
    source_branch character varying(200),
    source_pr character varying(50),
    repo character varying(200),
    error_type character varying(50),
    updated_at timestamp without time zone,
    last_reinforced_at timestamp with time zone,
    author character varying(32) DEFAULT 'cecelia'::character varying NOT NULL,
    made_by character varying(20) DEFAULT 'cecelia'::character varying NOT NULL,
    dispatch_constraint jsonb,
    task_id uuid,
    parent_learning_id uuid,
    verified_effective boolean,
    CONSTRAINT learnings_pkey PRIMARY KEY (id),
    CONSTRAINT learnings_learning_type_check CHECK (((learning_type IS NULL) OR ((learning_type)::text = ANY ((ARRAY['trap'::character varying, 'architecture_decision'::character varying, 'process_improvement'::character varying, 'failure_pattern'::character varying, 'best_practice'::character varying])::text[])))),
    CONSTRAINT learnings_made_by_check CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying])::text[]))),
    CONSTRAINT learnings_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.learnings(id),
    CONSTRAINT learnings_parent_learning_id_fkey FOREIGN KEY (parent_learning_id) REFERENCES public.learnings(id)
);

CREATE INDEX IF NOT EXISTS idx_learnings_created_at ON public.learnings USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON public.learnings USING btree (category);
CREATE INDEX IF NOT EXISTS idx_learnings_is_latest ON public.learnings USING btree (is_latest) WHERE (is_latest = true);

-- pgvector 有就补 embedding 列 + hnsw 索引，没有就跳过，不让整段 fixture 因它失败
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector 不可用，跳过 embedding 列（本 sprint 零向量化）';
    RETURN;
  END;
  ALTER TABLE public.learnings ADD COLUMN IF NOT EXISTS embedding public.vector(1536);
  CREATE INDEX IF NOT EXISTS learnings_embedding_idx ON public.learnings
    USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
END
$$;
