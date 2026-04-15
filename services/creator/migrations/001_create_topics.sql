-- Migration 001: 创建 topics 表（选题池 v1）
-- Brain Task: 4aac48fe-048a-4f82-9750-57e6614e0c62
-- 主理人清单驱动的选题源头

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    angle TEXT,
    priority INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT '待研究'
        CHECK(status IN ('待研究', '已通过', '研究中', '已发布', '已拒绝')),
    target_platforms TEXT NOT NULL DEFAULT '["xiaohongshu","douyin","kuaishou","shipinhao","x","toutiao","weibo","wechat"]',
    scheduled_date TEXT,
    pipeline_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_priority ON topics(priority);
CREATE INDEX IF NOT EXISTS idx_topics_scheduled_date ON topics(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_topics_deleted_at ON topics(deleted_at);

-- 节奏配置（独立 key/value 表，不依赖现有 settings）
CREATE TABLE IF NOT EXISTS pacing_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO pacing_config (key, value, updated_at)
VALUES ('daily_limit', '1', datetime('now'));
