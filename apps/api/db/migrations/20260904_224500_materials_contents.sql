-- 素材上传链路（决策 ca3b66ee 的上游）：素材池 + 作品 + 多对多关联三张表。
--
-- 为什么素材和作品要分开、还要一张关联表：
--   一次上传要同时满足两件事——① 传完就是一个作品，可以直接发（你不用先建作品
--   再往里塞东西）；② 素材以后能被混剪复用。分表 + 关联表让这两件事一次做完，
--   使用者不用做任何选择。
--   混剪时从池子里跨作品挑素材，**不是把素材移走**，只是多插一条关联——原作品
--   一根汗毛不动，同一个素材可以同时属于 N 个作品。
--
-- 租户隔离：materials / contents 都带 tenant_id，且客户端**绝不能自报**它，
--   必须服务端从凭据反查（照 middleware/worker-agent-auth.ts 的形状）。
--
-- 去重：dedupe_key 上唯一索引。去重做在服务端而不是让客户端删相册——误删用户
--   原片不可逆，而服务端去重后重复上传完全无害，iOS 定时任务可以放心全量跑。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

CREATE TABLE IF NOT EXISTS zenithjoy.materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT NOT NULL,
  duration_ms   INTEGER,
  width         INTEGER,
  height        INTEGER,
  content_hash  TEXT,
  -- 去重键：有内容 hash 用 hash，否则 文件名+大小+拍摄时间，租户永远进键
  dedupe_key    TEXT NOT NULL,
  taken_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同一租户同一素材只存一条。跨租户互不影响（tenant_id 已经在 dedupe_key 里）。
CREATE UNIQUE INDEX IF NOT EXISTS materials_dedupe_key_uniq
  ON zenithjoy.materials (dedupe_key);

CREATE INDEX IF NOT EXISTS materials_tenant_created_idx
  ON zenithjoy.materials (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zenithjoy.contents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL,
  title         TEXT,
  -- 对应各平台发布器统一契约里的 content 字段（{ title, content, images[] }）
  body          TEXT,
  -- video / image / article：从素材推断，不接受客户端指定
  type          TEXT NOT NULL,
  platforms     TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contents_tenant_status_idx
  ON zenithjoy.contents (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS zenithjoy.content_materials (
  content_id    UUID NOT NULL REFERENCES zenithjoy.contents(id) ON DELETE CASCADE,
  material_id   UUID NOT NULL REFERENCES zenithjoy.materials(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (content_id, material_id)
);

-- 反查「这个素材被哪些作品用了」——混剪场景要用，也是删素材前的安全检查
CREATE INDEX IF NOT EXISTS content_materials_material_idx
  ON zenithjoy.content_materials (material_id);
