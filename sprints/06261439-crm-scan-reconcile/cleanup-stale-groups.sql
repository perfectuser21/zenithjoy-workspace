-- 一次性：软删 staging zenithjoy_test 里修复前扫进的旧群条目（可恢复，不物理删）。
-- 旧群命名特征：客户名后缀「、徐先生企业自媒体-Ai助力」或「悦升云端群」等 2-3 人小群。
-- ⚠️ 不自动跑。staging 验证时先 SELECT 核对命中行，确认无误再 UPDATE；生产 promote 由用户决定。
--
-- 1) 先核对命中（应只命中旧群、不含 18 真客户私聊）：
--   SELECT contact, source, created_at FROM zenithjoy.crm_customers
--    WHERE source='scan' AND deleted_at IS NULL
--      AND (contact LIKE '%、徐先生企业自媒体-Ai助力%' OR contact LIKE '%悦升云端群%')
--    ORDER BY contact;
--
-- 2) 核对无误后软删：
UPDATE zenithjoy.crm_customers
   SET deleted_at = now(), updated_at = now()
 WHERE source = 'scan'
   AND deleted_at IS NULL
   AND (contact LIKE '%、徐先生企业自媒体-Ai助力%' OR contact LIKE '%悦升云端群%');
--
-- 3) 误删恢复（如需）：把对应 contact 的 deleted_at 置回 NULL，或等下次扫到自动复活
--    （扫到即 deleted_at=NULL + scan_miss_count=0）。
