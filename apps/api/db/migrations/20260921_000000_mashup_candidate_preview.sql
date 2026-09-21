-- 批量混剪加厚（GP line05/batch_mashup step3）：候选真实轻量预览（决策 623a81d7）。
--
-- 纠偏 d6bedf80 的候选预览部分——纯缩略图拼贴盲选不满足用户诉求（对比剪映/CapCut，
-- 用户要求合成前能看到真实可播放效果才决定选谁）。本列驱动"点了才现渲染"的懒加载
-- 轻量预览：候选生成期仍不渲染，用户点某条候选的预览按钮才触发，独立于终版渲染
-- 队列（各自并发上限=1，互不阻塞——预览追求秒开体验，不该被终版排队卡住；
-- 两把锁合计最坏 2 个并发 ffmpeg 进程，hk-vps 4 核可接受）。
--
-- 状态机（落在本列）：none →（入队）→ generating →（渲染完）→ ready
--                                                          → failed（可重试，非死路）
--
-- preview_url：轻量预览产物签名 URL（低清/快编码档，非最终画质，见
-- mashup-preview-render.ts）。不加 CHECK 约束绑死状态字面值（同
-- mashup_render_queue.sql 的取舍——三态转移由应用层控制）。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.mashup_candidates
  ADD COLUMN IF NOT EXISTS preview_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS preview_url TEXT;
