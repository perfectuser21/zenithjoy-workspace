-- 批量混剪 S4（GP f6f96e17）：高清成片渲染 + 内容安全 Gate 落库。
--
-- 复用既有 zenithjoy.contents 表（不新建平行表）——proposal-v2.md 验收断言 A1
-- 明确写死"psql 查询对应 content_id 的 safety_check_status/watermark_check_status
-- 字段"，S4 产出的成片就是一条 contents 记录，与素材上传链路共用同一张作品表。
--
-- fail-closed（A1）：safety_check_status/watermark_check_status 只要非 'passed'，
-- export_url/download_url 必须是 NULL——渲染服务层保证，这里只提供列，不加 CHECK
-- 约束（三态转移由应用层控制，约束会跟 status_status 字面值强耦合，未来加状态要改
-- DDL，不划算）。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.contents
  ADD COLUMN IF NOT EXISTS safety_check_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS watermark_check_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS export_url TEXT,
  ADD COLUMN IF NOT EXISTS download_url TEXT,
  ADD COLUMN IF NOT EXISTS source_candidate_id UUID REFERENCES zenithjoy.mashup_candidates(id);

CREATE INDEX IF NOT EXISTS contents_source_candidate_idx
  ON zenithjoy.contents (source_candidate_id);
