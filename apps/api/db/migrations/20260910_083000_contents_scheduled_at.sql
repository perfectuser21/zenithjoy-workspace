-- contents 加 scheduled_at：作品定时发送时间镜像（NULL=立即派）。
-- 到点判定不走 DB 扫描——编排 worker（notion/feishu orchestrator）拉发方向逐行判
-- 「定时」<=now 才派，本列只是派发时镜像进 DB 供列表/审计，故不加索引。
-- 全部 DDL 幂等（CI glob runner 全量重放）；不包 BEGIN/COMMIT（run-migration.ts 外层有事务）。

ALTER TABLE zenithjoy.contents ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

COMMENT ON COLUMN zenithjoy.contents.scheduled_at IS '定时发送时间；NULL=立即派发。编排 worker 拉发方向到点(<=now)才派单，派发时从编排台镜像写入';
