-- 批量混剪加厚（GP line05/batch_mashup step1-4）：候选懒渲染态 + 缩略图列。
--
-- Step3 懒渲染（PRD Step3/Step4）：候选生成期绝不真实渲染，落库 render_status
-- 恒为 'pending'；客户选中后按需渲染才推进状态机
--   pending → queued → rendering → rendered / render_failed
-- 状态机由应用层（mashup-render-queue.ts）单进程内存信号量 + 本列落态驱动，
-- 前端据本列呈现「排队第 N 位 / 渲染中 / 渲染失败可重试」（决策 d6bedf80：
-- hk-vps 4 核，真实渲染并发上限=1）。
--
-- thumbnail_url：候选缩略图拼贴（抽帧自 video-frame-extract.ts），生成期尽力而为，
-- 抽不出留 NULL（前端占位），真实缩略图由 hk-vps L3 E2E 覆盖。
--
-- 不加 CHECK 约束绑死状态字面值（同 mashup_export_gate.sql 的取舍——三态转移
-- 由应用层控制，未来加状态不必改 DDL）。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.mashup_candidates
  ADD COLUMN IF NOT EXISTS render_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- 按 run 拉候选时常带 render_status 过滤/展示，建复合索引省一次全表扫。
CREATE INDEX IF NOT EXISTS mashup_candidates_run_render_status_idx
  ON zenithjoy.mashup_candidates (run_id, render_status);
