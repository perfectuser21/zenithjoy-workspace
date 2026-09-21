-- 混剪历史 + 素材视频预览 Final E2E 的种子数据（GP line05/batch_mashup）
--
-- 造一个租户，里面有：
--   · 1 条视频素材（点开要能播）
--   · run-pending：有候选、没选定 → stage=candidates_pending，点进去恢复候选页
--   · run-done：选了候选、contents.export_url 非空 → stage=completed，点进去看成片
--   · run-gated：选了候选但被安全 Gate 拦下（export_url 为 NULL）→ stage=rendering
--     这条是判定点的活体证据：mashup_runs.status 写着 completed，但没有成片，
--     列表必须显示"渲染中"而不是"已完成"，否则客户点进去看不到片子。
--
-- 幂等：先清空本租户全部数据再重建，而不是只靠 ON CONFLICT DO NOTHING。
-- 原因（本地实跑踩到）：E2E 断言"候选恰好 2 条"，而一旦某次跑因为代码回归真的调了
-- 候选生成接口，就会往这个 run 里**真写一条新候选**，下一次跑候选变 3 条、断言从此
-- 长红且看着像是断言写错了。种子必须是"重置"而不是"补齐"，否则一次污染永久跑偏。

\set ON_ERROR_STOP on

DELETE FROM zenithjoy.contents  WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111';
UPDATE zenithjoy.mashup_runs SET selected_candidate_id = NULL
 WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111';
DELETE FROM zenithjoy.mashup_candidates WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111';
DELETE FROM zenithjoy.mashup_slot_assignments
 WHERE run_id IN (SELECT id FROM zenithjoy.mashup_runs
                   WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111');
DELETE FROM zenithjoy.mashup_runs WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111';
DELETE FROM zenithjoy.materials   WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111';

INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES ('e2e11111-1111-4111-8111-111111111111', 'e2e-mashup-history', 'e2e-lk-mashup-history', 'free')
ON CONFLICT (id) DO NOTHING;

INSERT INTO zenithjoy.licenses (id, license_key, tier, max_machines, tenant_id, status, expires_at)
VALUES ('e2e22222-2222-4222-8222-222222222222', 'ZJ-F-E2EMASHUP', 'free', 5,
        'e2e11111-1111-4111-8111-111111111111', 'active', NOW() + INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

-- 视频素材：mime 故意写 application/octet-stream —— iPhone 快捷指令传上来就是这样，
-- 后端 previewAvailable 会因此判 false，而前端 isVideo() 靠扩展名兜底判 true。
-- 这正是本功能的判定点：播放与否只看"签出了地址"，不看 previewAvailable。
INSERT INTO zenithjoy.materials
  (id, tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags)
VALUES
  ('e2e33333-3333-4333-8333-333333333333', 'e2e11111-1111-4111-8111-111111111111',
   'e2e/mashup-history/sample.mov', 'IMG_E2E_0001.MOV', 'application/octet-stream', 11264,
   'e2e-dedupe-mashup-history', 'tagged', '["产品特写","细节"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO zenithjoy.mashup_runs (id, tenant_id, template_id, status, created_at)
SELECT 'e2e44444-4444-4444-8444-444444444444', 'e2e11111-1111-4111-8111-111111111111',
       t.id, 'pending', NOW() - INTERVAL '3 hours'
  FROM zenithjoy.mashup_templates t WHERE t.tenant_id IS NULL LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO zenithjoy.mashup_runs (id, tenant_id, template_id, status, created_at)
SELECT 'e2e55555-5555-4555-8555-555555555555', 'e2e11111-1111-4111-8111-111111111111',
       t.id, 'completed', NOW() - INTERVAL '2 hours'
  FROM zenithjoy.mashup_templates t WHERE t.tenant_id IS NULL LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO zenithjoy.mashup_runs (id, tenant_id, template_id, status, created_at)
SELECT 'e2e66666-6666-4666-8666-666666666666', 'e2e11111-1111-4111-8111-111111111111',
       t.id, 'completed', NOW() - INTERVAL '1 hour'
  FROM zenithjoy.mashup_templates t WHERE t.tenant_id IS NULL LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- run-pending 的两个候选（列表显示"2 个候选方案"，点进去恢复候选页要看到它们）
INSERT INTO zenithjoy.mashup_candidates
  (id, run_id, tenant_id, slot_fill, score, signature, thumbnail_url, render_status, preview_status)
VALUES
  ('e2e77777-7777-4777-8777-777777777777', 'e2e44444-4444-4444-8444-444444444444',
   'e2e11111-1111-4111-8111-111111111111',
   '{"hook":"e2e33333-3333-4333-8333-333333333333"}'::jsonb, 2.5, 'e2e-sig-pending-a',
   NULL, 'pending', 'none'),
  ('e2e88888-8888-4888-8888-888888888888', 'e2e44444-4444-4444-8444-444444444444',
   'e2e11111-1111-4111-8111-111111111111',
   '{"product":"e2e33333-3333-4333-8333-333333333333"}'::jsonb, 1.8, 'e2e-sig-pending-b',
   NULL, 'pending', 'none')
ON CONFLICT (id) DO NOTHING;

-- run-done 选中的候选 + 真的产出了成片
INSERT INTO zenithjoy.mashup_candidates
  (id, run_id, tenant_id, slot_fill, score, signature, thumbnail_url, render_status, preview_status)
VALUES
  ('e2e99999-9999-4999-8999-999999999999', 'e2e55555-5555-4555-8555-555555555555',
   'e2e11111-1111-4111-8111-111111111111',
   '{"hook":"e2e33333-3333-4333-8333-333333333333"}'::jsonb, 3.1, 'e2e-sig-done',
   NULL, 'rendered', 'ready')
ON CONFLICT (id) DO NOTHING;

UPDATE zenithjoy.mashup_runs
   SET selected_candidate_id = 'e2e99999-9999-4999-8999-999999999999'
 WHERE id = 'e2e55555-5555-4555-8555-555555555555';

INSERT INTO zenithjoy.contents
  (id, tenant_id, type, source_candidate_id, safety_check_status, watermark_check_status, export_url, download_url)
VALUES
  ('e2eaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2e11111-1111-4111-8111-111111111111', 'video',
   'e2e99999-9999-4999-8999-999999999999', 'passed', 'passed',
   'memory://e2e/mashup-history/export.mp4', 'memory://e2e/mashup-history/export.mp4')
ON CONFLICT (id) DO NOTHING;

-- run-gated 选中的候选 + 被安全 Gate 拦下（export_url 必须为 NULL，fail-closed）
INSERT INTO zenithjoy.mashup_candidates
  (id, run_id, tenant_id, slot_fill, score, signature, thumbnail_url, render_status, preview_status)
VALUES
  ('e2ebbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e2e66666-6666-4666-8666-666666666666',
   'e2e11111-1111-4111-8111-111111111111',
   '{"cta":"e2e33333-3333-4333-8333-333333333333"}'::jsonb, 2.2, 'e2e-sig-gated',
   NULL, 'rendered', 'none')
ON CONFLICT (id) DO NOTHING;

UPDATE zenithjoy.mashup_runs
   SET selected_candidate_id = 'e2ebbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 WHERE id = 'e2e66666-6666-4666-8666-666666666666';

INSERT INTO zenithjoy.contents
  (id, tenant_id, type, source_candidate_id, safety_check_status, watermark_check_status, export_url, download_url)
VALUES
  ('e2eccccc-cccc-4ccc-8ccc-cccccccccccc', 'e2e11111-1111-4111-8111-111111111111', 'video',
   'e2ebbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'failed_pending_review', 'passed', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

SELECT '种子就绪：' ||
  (SELECT COUNT(*) FROM zenithjoy.mashup_runs WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111') ||
  ' 条 run，' ||
  (SELECT COUNT(*) FROM zenithjoy.materials WHERE tenant_id = 'e2e11111-1111-4111-8111-111111111111') ||
  ' 条素材' AS seeded;
