-- Meta 发布幂等表（Cloudflare D1）
--
-- 为什么必须是 D1 而不是 KV：
--   发布是不可逆的对外动作。KV 无 compare-and-set，`get` 后 `put` 之间存在
--   TOCTOU 窗口；且 KV 最终一致，写入全球传播可达 60s。两者叠加会让并发（甚至
--   仅仅是落在不同边缘节点的串行）请求双双读到空、双双发帖。
--   这里靠 idempotency_key 的 PRIMARY KEY 约束提供原子声明：
--   INSERT ... ON CONFLICT DO NOTHING 时 changes=1 才算抢到。
--
-- 应用：wrangler d1 execute <db> --file=sprints/09161245-meta-publishing/schema.sql

CREATE TABLE IF NOT EXISTS meta_publish_attempts (
  idempotency_key TEXT PRIMARY KEY,
  -- pending | instagram_container_created | succeeded
  state           TEXT NOT NULL,
  -- 内容指纹：同 key 不同内容 → 409 冲突，防止 key 复用发出不同帖子
  fingerprint     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  -- IG 两阶段发布的容器 id；重试复用，避免留下多个容器
  container_id    TEXT,
  -- 成功后的公开结果（JSON），仅存 post id，绝不存 token
  result          TEXT
);

-- 便于按时间清理过期 pending（发布结果不明的记录需人工复核，不自动删）
CREATE INDEX IF NOT EXISTS idx_meta_publish_attempts_created_at
  ON meta_publish_attempts (created_at);
