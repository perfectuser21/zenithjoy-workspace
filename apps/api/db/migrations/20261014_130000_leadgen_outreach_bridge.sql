-- 真实102原生主页证据和103 comment→lead→原飞书异步意图，不改变分档。
ALTER TABLE zenithjoy.leadgen_comments ADD COLUMN IF NOT EXISTS recipient_evidence jsonb;
CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_bridge_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 line_key text NOT NULL,
 comment_id uuid NOT NULL REFERENCES zenithjoy.leadgen_comments(id),
 lead_id uuid NOT NULL REFERENCES zenithjoy.leadgen_leads(id),
 run_tag text NOT NULL,
 source_run text,
 payload jsonb NOT NULL,
 payload_sha256 text NOT NULL,
 qualification_status text NOT NULL CHECK(qualification_status IN ('passed','excluded','unknown')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempted','confirmed','protected','excluded','unknown')),
 attempted_at timestamptz,
 feishu_record_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(line_key,comment_id)
);
CREATE INDEX IF NOT EXISTS leadgen_bridge_outbox_pending ON zenithjoy.leadgen_bridge_outbox(line_key,created_at)
 WHERE state IN ('pending','attempted','unknown');
