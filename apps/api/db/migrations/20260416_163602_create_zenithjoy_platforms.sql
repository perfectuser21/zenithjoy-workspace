-- 平台配置表（10 行种子数据）
-- PR-a（彻底重构 1/5）
-- 幂等：可重复执行
--
-- 字段设计参考：/tmp/pipeline-migration-plan/01-target-schema.md § 3

CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.platforms (
    id          VARCHAR(30) PRIMARY KEY,
    code        VARCHAR(30) UNIQUE NOT NULL,
    name        VARCHAR(50) NOT NULL,
    icon        VARCHAR(10),
    sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO zenithjoy.platforms (id, code, name, icon, sort_order) VALUES
    ('xiaohongshu','xiaohongshu','小红书','📕',1),
    ('douyin',     'douyin',     '抖音',  '🎵',2),
    ('kuaishou',   'kuaishou',   '快手',  '⚡',3),
    ('shipinhao',  'shipinhao',  '视频号','📺',4),
    ('x',          'x',          'X',    '𝕏',5),
    ('toutiao',    'toutiao',    '头条',  '📰',6),
    ('weibo',      'weibo',      '微博',  '🔴',7),
    ('wechat',     'wechat',     '公众号','💚',8),
    ('zhihu',      'zhihu',      '知乎',  '🔵',9),
    ('bilibili',   'bilibili',   'B站',   '📹',10)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE zenithjoy.platforms IS '平台配置表（发布目标平台清单）';
