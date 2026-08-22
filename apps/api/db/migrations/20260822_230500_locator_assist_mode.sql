-- 铺满刀A：locator-assist 加 mode 列（locate 找元素 / extract 抽文本）。
ALTER TABLE zenithjoy.rpa_locator_assist ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'locate';
COMMENT ON COLUMN zenithjoy.rpa_locator_assist.mode IS 'locate=找元素点它 / extract=从页面抽取文本(如抖音号)；extract 不进缓存';
