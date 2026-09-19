-- 批量混剪 S3（GP f6f96e17）：语义检索候选生成落库。
--
-- materials.embedding：句子向量（JSONB 数组存 float），懒计算——首次候选生成时
-- 才算，算完写回缓存，同一素材不重复算。不用 pgvector（本库未装该扩展，新增
-- 扩展属于本步范围外的基础设施变更），候选规模（几十到几百个素材）用应用层
-- 余弦相似度足够，不需要向量索引。
--
-- mashup_candidates：一次候选生成批次产出的候选方案。slot_fill 是 jsonb
-- {slotKey: materialId}，score 是各槽位相似度之和（越高越好，仅用于同批次内
-- 排序，非跨批次可比的绝对值）。signature 是槽位分配集合的排序拼接，用于
-- J10 候选级去重（proposal-v2.md）——区别于 J1 材料级去重，这里判断的是
-- "不同候选组合会不会呈现出几乎一样的排列"。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.materials
  ADD COLUMN IF NOT EXISTS embedding JSONB;

CREATE TABLE IF NOT EXISTS zenithjoy.mashup_candidates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES zenithjoy.mashup_runs(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL,
  slot_fill     JSONB NOT NULL,
  score         NUMERIC NOT NULL,
  signature     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mashup_candidates_run_idx
  ON zenithjoy.mashup_candidates (run_id, score DESC);

-- 同一 run 内 signature 不重复——J10 候选级去重的落库层保险丝，服务层已经
-- 做了 Jaccard 相似度过滤，这里再加一道唯一约束防重复插入。
CREATE UNIQUE INDEX IF NOT EXISTS mashup_candidates_run_signature_uniq
  ON zenithjoy.mashup_candidates (run_id, signature);

-- S3 终态="候选已选定"（proposal-v2.md 切刀记录表）：客户从候选池挑一个，
-- 落这一列，S4 渲染读这里作为输入。NULL=尚未选定。
ALTER TABLE zenithjoy.mashup_runs
  ADD COLUMN IF NOT EXISTS selected_candidate_id UUID REFERENCES zenithjoy.mashup_candidates(id);
