-- 批量混剪口播刀（GP line05/batch_mashup#step4，决策 f10195d7）：把客户文案原文留下来。
--
-- 为什么要加这两列：generateTemplateFromScript 拿客户文案发给 AI 分段后，只把
-- slots（槽位定义）落库，**文案原文直接丢掉**。于是渲染时想拿它去 TTS 配音，
-- 系统里根本找不到——这正是"客户写的文案一个字都没进片子"的源头。
--
-- script_text：客户输入的原始文案，渲染时按它做 TTS 配音与字幕。
-- script_segments：AI 分段结果里每段对应的文案片段（与 slots 同序），
--   用于"这一句话配这一个镜头"的声画对齐——只有 slots 里的 match_tags
--   是不够的，那是标签不是话。
--
-- 两列都可空：内置模板（tenant_id IS NULL 的标准四槽位）本来就没有文案，
-- 老数据也不该被这次变更判死。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.mashup_templates
  ADD COLUMN IF NOT EXISTS script_text TEXT,
  ADD COLUMN IF NOT EXISTS script_segments JSONB;
