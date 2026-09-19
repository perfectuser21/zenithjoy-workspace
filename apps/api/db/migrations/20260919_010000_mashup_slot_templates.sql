-- 批量混剪 S2（GP f6f96e17）：套路模板 + 槽位分配落库。
--
-- mashup_templates：钩子/产品/证据/CTA 槽位模板库。slots 用 jsonb 数组存
-- [{key, required, match_tags[]}]——match_tags 是槽位关键词，跟 materials.ai_tags
-- 做重叠打分，不建单独的关键词表（模板数量小，jsonb 够用，避免过度设计）。
-- tenant_id 为 NULL = 全局内置模板，所有租户可见；非 NULL = 租户自定义模板。
--
-- mashup_runs：客户"这批视频要按什么套路剪"的一次决定，S3 候选生成从这里读槽位
-- 分配结果作为输入。
--
-- mashup_slot_assignments：run 内每个槽位的分配结果。status 三态对齐 proposal-v2.md
-- J4："assigned"(已分配素材) / "reshoot_skipped"(必填槽位缺素材且补拍服务未配置或
-- 补拍失败，按 J4 REC 跳过不阻断) / "unfilled"(选填槽位缺素材，非异常)。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

CREATE TABLE IF NOT EXISTS zenithjoy.mashup_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT,
  name          TEXT NOT NULL,
  slots         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mashup_templates_tenant_idx
  ON zenithjoy.mashup_templates (tenant_id);

CREATE TABLE IF NOT EXISTS zenithjoy.mashup_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL,
  template_id   UUID NOT NULL REFERENCES zenithjoy.mashup_templates(id),
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mashup_runs_tenant_idx
  ON zenithjoy.mashup_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zenithjoy.mashup_slot_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES zenithjoy.mashup_runs(id) ON DELETE CASCADE,
  slot_key      TEXT NOT NULL,
  material_id   UUID REFERENCES zenithjoy.materials(id),
  status        TEXT NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, slot_key)
);

CREATE INDEX IF NOT EXISTS mashup_slot_assignments_run_idx
  ON zenithjoy.mashup_slot_assignments (run_id);

-- 内置默认模板：钩子/产品/证据/CTA 四槽位，全局可见（tenant_id NULL）。
-- ON CONFLICT 用 name 做幂等锚点，避免 CI 重放 migration 时重复插入。
INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots)
SELECT NULL, '标准四槽位（钩子/产品/证据/CTA）',
  '[
    {"key":"hook","required":true,"match_tags":["开场","特写","悬念","冲突","惊讶"]},
    {"key":"product","required":true,"match_tags":["产品特写","产品展示","主体","细节"]},
    {"key":"evidence","required":false,"match_tags":["使用场景","效果对比","证据","实拍"]},
    {"key":"cta","required":true,"match_tags":["行动号召","下单","购买","咨询","结尾"]}
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL AND name = '标准四槽位（钩子/产品/证据/CTA）'
);
