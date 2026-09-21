-- TikTok 发布幂等表（复用 Meta 的 D1 库 zenithjoy-meta-publish）
--
-- 为什么主键是 (operation, idempotency_key) 而不是单列：
-- 调用方对同一份内容做「先传草稿、再私密发布」时，用同一个 idempotencyKey 是合法的。
-- 若只按 key 做主键，草稿的记录会把随后的发布误判成重放而直接跳过，
-- 真正的发布永远不会发生——这是静默丢动作，比重复发布更难发现。
--
-- 为什么不用 KV：KV 只有 get/put，没有条件写。「先读再写」之间的窗口会让
-- 并发请求各自调一次 TikTok 发布接口。D1 主键约束让
-- INSERT ... ON CONFLICT DO NOTHING 成为一次原子判定，只有 changes=1 的那个赢。
CREATE TABLE IF NOT EXISTS tiktok_publish_attempts (
  operation       TEXT NOT NULL,   -- publish | draft
  idempotency_key TEXT NOT NULL,
  state           TEXT NOT NULL,   -- pending | initialized
  fingerprint     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  publish_id      TEXT,
  PRIMARY KEY (operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_publish_attempts_created_at
  ON tiktok_publish_attempts (created_at);
