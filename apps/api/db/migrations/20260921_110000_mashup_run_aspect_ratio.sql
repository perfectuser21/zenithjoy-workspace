-- 批量混剪横竖屏选择（GP line05/batch_mashup#step4）：客户原话"抖音横屏和竖屏是我们要
-- 选择的呀，有的是横屏，有的是竖屏"——渲染层（mashup-render-ffmpeg.ts）早就支持
-- width/height 可传，但没有一处把客户的选择存下来再喂给它，渲染永远走硬编码的
-- 默认横屏 1920x1080。
--
-- aspect_ratio 落在 mashup_runs 而不是 mashup_candidates/contents：这是客户
-- "这批片子怎么出"的一次性设定（proposal-v2.md Step1 挑素材同一批做的决定），
-- 跟套路模板同一层级；真正渲染发生在客户稍后点"选这个"才触发（决策 d6bedf80
-- 异步并发=1队列，POST /candidates/:id/render 只带 candidateId，不在同一次
-- HTTP 请求里能拿到这个选择了），run 是唯一贯穿"挑素材时选比例"与"点渲染时
-- 用比例"两端的锚点，必须落库，不能只存前端内存态。
--
-- 默认 'landscape'：与 mashup-render-ffmpeg.ts 现有硬编码默认（1920x1080）一致，
-- 保证迁移前创建的老 run 输出行为不变，不因为加了这一列就悄悄换了老数据的产物。
-- 新建 run 由 Dashboard 显式传值（前端默认预选竖屏，抖音推荐），不依赖这个 DB
-- 默认——这个默认只兜底"请求没带 aspectRatio 的调用方 / 迁移前的老数据"。
--
-- 不加 CHECK 约束绑死字面值（同 mashup_export_gate.sql / mashup_candidates
-- .render_status 的取舍——三态/两态转移校验放应用层 routes/mashup.ts，未来加
-- 新比例不必改 DDL）。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.mashup_runs
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT 'landscape';
