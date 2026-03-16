-- ============================================
-- ZenithJoy Works Management System
-- Migration: 003 — Apply works + publish_logs tables
-- Version: 003
-- Created: 2026-03-16
-- Idempotent: YES (safe to run multiple times)
--
-- 说明：002 定义了表结构但从未执行。
-- 003 是正式执行版本，包含 content_type 枚举更新：
--   long_form_article | image_text | video（三种内容类型）
-- ============================================
--
-- 执行方式（需要 PostgreSQL 环境变量或直接指定）：
--   PGPASSWORD=xxx psql -h localhost -p 5432 -U postgres -d cecelia -f 003_apply_works_tables.sql
--
-- ============================================

BEGIN;

-- ==================== Schema ====================
CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ==================== zenithjoy.works ====================
CREATE TABLE IF NOT EXISTS zenithjoy.works (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 内容标识（与 NAS content-id 对应，如 2026-03-16-a3f2b1）
    content_id VARCHAR(50) UNIQUE,

    -- 基础信息
    title VARCHAR(500) NOT NULL,
    body TEXT,                          -- Markdown 格式正文
    content_type VARCHAR(30) NOT NULL   -- 'long_form_article' | 'image_text' | 'video'
        CHECK (content_type IN ('long_form_article', 'image_text', 'video')),

    -- NAS 存储路径
    nas_path VARCHAR(500),              -- /volume1/workspace/vault/zenithjoy-creator/content/{content_id}

    -- 媒体文件
    cover_image VARCHAR(500),           -- 封面图路径（相对于 nas_path）
    media_files JSONB DEFAULT '[]',     -- 图片/视频数组

    -- 平台发布链接（发布后填入）
    platform_links JSONB DEFAULT '{}',
    -- 示例: {"wechat": "https://...", "douyin": "https://..."}

    -- 状态
    status VARCHAR(20) DEFAULT 'draft'  -- 'draft' | 'ready' | 'publishing' | 'published' | 'archived'
        CHECK (status IN ('draft', 'ready', 'publishing', 'published', 'archived')),

    -- 标记
    is_featured BOOLEAN DEFAULT FALSE,
    is_viral BOOLEAN DEFAULT FALSE,

    -- 时间
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    first_published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_works_status ON zenithjoy.works(status);
CREATE INDEX IF NOT EXISTS idx_works_type ON zenithjoy.works(content_type);
CREATE INDEX IF NOT EXISTS idx_works_content_id ON zenithjoy.works(content_id);
CREATE INDEX IF NOT EXISTS idx_works_created ON zenithjoy.works(created_at DESC);

-- ==================== zenithjoy.publish_logs ====================
CREATE TABLE IF NOT EXISTS zenithjoy.publish_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 关联 works 表
    work_id UUID NOT NULL REFERENCES zenithjoy.works(id) ON DELETE CASCADE,

    -- 平台信息
    platform VARCHAR(20) NOT NULL
        CHECK (platform IN ('wechat', 'douyin', 'xiaohongshu', 'zhihu', 'toutiao', 'kuaishou', 'weibo')),

    -- 平台返回的帖子 ID（用于后续数据采集关联）
    platform_post_id VARCHAR(200),

    -- 发布状态
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped')),

    -- 时间
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- 平台返回的完整响应（调试用）
    response JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- 数据指标（由采集脚本定期回填）
    metrics JSONB DEFAULT '{}'
    -- 示例: {"views": 1240, "likes": 88, "comments": 12, "shares": 5}
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_publish_logs_work_id ON zenithjoy.publish_logs(work_id);
CREATE INDEX IF NOT EXISTS idx_publish_logs_platform ON zenithjoy.publish_logs(platform);
CREATE INDEX IF NOT EXISTS idx_publish_logs_status ON zenithjoy.publish_logs(status);
CREATE INDEX IF NOT EXISTS idx_publish_logs_platform_post ON zenithjoy.publish_logs(platform_post_id) WHERE platform_post_id IS NOT NULL;

-- ==================== updated_at 自动更新触发器 ====================
CREATE OR REPLACE FUNCTION zenithjoy.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS works_updated_at ON zenithjoy.works;
CREATE TRIGGER works_updated_at
    BEFORE UPDATE ON zenithjoy.works
    FOR EACH ROW EXECUTE FUNCTION zenithjoy.update_updated_at();

DROP TRIGGER IF EXISTS publish_logs_updated_at ON zenithjoy.publish_logs;
CREATE TRIGGER publish_logs_updated_at
    BEFORE UPDATE ON zenithjoy.publish_logs
    FOR EACH ROW EXECUTE FUNCTION zenithjoy.update_updated_at();

COMMIT;

-- ==================== 验证 ====================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'zenithjoy' AND table_name = 'works') THEN
        RAISE NOTICE '✅ zenithjoy.works 表创建成功';
    ELSE
        RAISE EXCEPTION '❌ zenithjoy.works 表创建失败';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'zenithjoy' AND table_name = 'publish_logs') THEN
        RAISE NOTICE '✅ zenithjoy.publish_logs 表创建成功';
    ELSE
        RAISE EXCEPTION '❌ zenithjoy.publish_logs 表创建失败';
    END IF;
END $$;
