-- Line04 客服工作汇总 — 清理某一轮种子（按 RUN 唯一标记，绝不误删他人数据）
-- 用法：psql "$DATABASE_URL" -v RUN=<同 seed 的标记> -f cleanup.sql
DELETE FROM zenithjoy.cs_memory_messages
 WHERE cs_wechat_id IN (:'RUN', :'RUN' || '-dry');
DELETE FROM zenithjoy.wechat_cs_account_config
 WHERE wechat_id IN (:'RUN', :'RUN' || '-dry');
