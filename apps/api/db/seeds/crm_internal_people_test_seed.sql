-- crm_internal_people_test_seed.sql — 【仅 test 库 / 手动执行，绝不进 migrations 自动跑】
--
-- 把内部人员（运营自己/同事，不是客户）在 crm_customers 标 identity='internal'，让 GET /api/crm/customers 排除他们。
-- 内部人员名单（用户 Notion 名册，2026-06-25）：徐啸 / 于瑾 / 苏彦卿。
--
-- 为什么不放进 migration：
--   1. 这是数据，不是 schema；不同租户/客服机下 contact 行才存在，硬编码进 prod 自动迁移会污染生产名册。
--   2. identity 列默认 'customer'，标 internal 是「运营在界面上点一下」的运营动作（将来前端补「标为内部」按钮），
--      或后台对 test 库一次性灌入。本文件就是 test 库的一次性灌入脚本。
--
-- 用法（对 test 库 zenithjoy_test 手动执行；按真实 cs_wechat_id 改 :cs 变量后跑）：
--   psql "$DATABASE_URL" -v cs="'<cs_wechat_id>'" -f apps/api/db/seeds/crm_internal_people_test_seed.sql
--
-- 身份匹配 key = contact（微信昵称，与名册 key 同字面）；只更新已存在的行，不新建（避免凭空造客户）。
-- 幂等：重复跑只是把 identity 反复设成 internal。

UPDATE zenithjoy.crm_customers
   SET identity = 'internal', updated_at = now()
 WHERE contact IN ('徐啸', '于瑾', '苏彦卿')
   AND (:'cs' = '' OR cs_wechat_id = :cs);

-- 核对：列出被标为 internal 的内部人员行
SELECT cs_wechat_id, contact, wechat_id, identity
  FROM zenithjoy.crm_customers
 WHERE contact IN ('徐啸', '于瑾', '苏彦卿')
   AND identity = 'internal';
