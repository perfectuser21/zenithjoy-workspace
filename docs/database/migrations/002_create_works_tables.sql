-- ============================================
-- ZenithJoy Works Management System
-- Migration: Create works, publish_logs, field_definitions tables
-- Version: 002
-- Created: 2026-02-10
-- ============================================

BEGIN;

-- ==================== Create zenithjoy schema if not exists ====================
CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ==================== Table: zenithjoy.works ====================
-- 作品表：存储所有内容作品（文本/图文/视频/长文/音频）

CREATE TABLE IF NOT EXISTS zenithjoy.works (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 基础信息
    title VARCHAR(500) NOT NULL,
    body TEXT,                          -- Markdown 格式正文
    body_en TEXT,                       -- 英文版（可选）
    content_type VARCHAR(20) NOT NULL,  -- 'text' | 'image' | 'video' | 'article' | 'audio'

    -- 媒体文件
    cover_image VARCHAR(500),           -- 封面图 URL
    media_files JSONB,                  -- 图片/视频数组
    -- 示例：
    -- [
    --   {
    --     "type": "image",
    --     "url": "nas://media/works/2026-02/image1.jpg",
    --     "thumbnail": "nas://media/works/2026-02/image1_thumb.jpg",
    --     "size": 1024000,
    --     "caption": "图片说明",
    --     "order": 1
    --   }
    -- ]

    -- 平台链接（发布后）
    platform_links JSONB,
    -- 示例：
    -- {
    --   "douyin": "https://douyin.com/video/7xxx",
    --   "xiaohongshu": "https://xiaohongshu.com/xxx"
    -- }

    -- 状态
    status VARCHAR(20) DEFAULT 'draft', -- 'draft' | 'ready' | 'published' | 'archived'
    account VARCHAR(50),                -- 'XXIP' | 'XXAI'

    -- 标记
    is_featured BOOLEAN DEFAULT FALSE,  -- 精品
    is_viral BOOLEAN DEFAULT FALSE,     -- 爆款
    archived BOOLEAN DEFAULT FALSE,

    -- 时间
    created_at TIMESTAMP DEFAULT NOW(),       -- 创作日期
    scheduled_at TIMESTAMP,                   -- 计划发布
    first_published_at TIMESTAMP,             -- 首次发布
    updated_at TIMESTAMP DEFAULT NOW(),       -- 最后修改
    archived_at TIMESTAMP,                    -- 归档时间

    -- 自定义字段（用户可在前台增删）
    custom_fields JSONB
    -- 示例：
    -- {
    --   "tags": ["创作系统", "AI"],
    --   "priority": "high",
    --   "internal_notes": "这是内部笔记"
    -- }
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_works_status ON zenithjoy.works(status);
CREATE INDEX IF NOT EXISTS idx_works_type ON zenithjoy.works(content_type);
CREATE INDEX IF NOT EXISTS idx_works_created ON zenithjoy.works(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_works_archived ON zenithjoy.works(archived) WHERE archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_works_custom ON zenithjoy.works USING GIN (custom_fields);

-- 注释
COMMENT ON TABLE zenithjoy.works IS '作品表：存储所有内容作品';
COMMENT ON COLUMN zenithjoy.works.id IS '主键 UUID';
COMMENT ON COLUMN zenithjoy.works.title IS '作品标题';
COMMENT ON COLUMN zenithjoy.works.body IS '正文内容（Markdown 格式）';
COMMENT ON COLUMN zenithjoy.works.content_type IS '内容类型：text/image/video/article/audio';
COMMENT ON COLUMN zenithjoy.works.custom_fields IS '自定义字段（JSONB），用户可在前台增删';

-- ==================== Table: zenithjoy.publish_logs ====================
-- 发布日志表：记录作品发布到各平台的历史

CREATE TABLE IF NOT EXISTS zenithjoy.publish_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL REFERENCES zenithjoy.works(id) ON DELETE CASCADE,

    -- 发布信息
    platform VARCHAR(20) NOT NULL,      -- 'douyin' | 'xiaohongshu' | 'toutiao' | 'kuaishou' | 'weibo' | 'zhihu' | 'channels'
    platform_post_id VARCHAR(100),      -- 平台返回的作品ID

    -- 状态
    status VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'publishing' | 'published' | 'failed'

    -- 时间
    scheduled_at TIMESTAMP,             -- 计划发布时间
    published_at TIMESTAMP,             -- 实际发布时间
    created_at TIMESTAMP DEFAULT NOW(),

    -- 额外信息
    response JSONB,                     -- 平台返回的完整响应
    error_message TEXT,                 -- 失败原因
    retry_count INTEGER DEFAULT 0       -- 重试次数
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_publish_work ON zenithjoy.publish_logs(work_id);
CREATE INDEX IF NOT EXISTS idx_publish_platform ON zenithjoy.publish_logs(platform);
CREATE INDEX IF NOT EXISTS idx_publish_status ON zenithjoy.publish_logs(status);
CREATE INDEX IF NOT EXISTS idx_publish_scheduled ON zenithjoy.publish_logs(scheduled_at) WHERE status = 'pending';

-- 唯一约束（一个作品在同一平台只能有一条发布记录）
CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_unique ON zenithjoy.publish_logs(work_id, platform);

-- 注释
COMMENT ON TABLE zenithjoy.publish_logs IS '发布日志表：记录作品发布到各平台的历史';
COMMENT ON COLUMN zenithjoy.publish_logs.work_id IS '关联的作品 ID';
COMMENT ON COLUMN zenithjoy.publish_logs.platform IS '发布平台';
COMMENT ON COLUMN zenithjoy.publish_logs.platform_post_id IS '平台返回的作品 ID，用于追踪数据';

-- ==================== Table: zenithjoy.field_definitions ====================
-- 字段定义表：存储用户自定义的字段配置

CREATE TABLE IF NOT EXISTS zenithjoy.field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 字段信息
    field_name VARCHAR(100) NOT NULL UNIQUE,  -- "标签", "优先级", "心情"
    field_type VARCHAR(20) NOT NULL,          -- 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'checkbox'

    -- 选项（单选/多选类型）
    options JSONB,
    -- 示例（单选）：
    -- ["高", "中", "低"]
    -- 示例（多选）：
    -- ["创作系统", "执行系统", "趋势判断", "生活场景"]

    -- 显示
    display_order INTEGER DEFAULT 0,    -- 显示顺序
    is_visible BOOLEAN DEFAULT TRUE,    -- 是否显示

    -- 时间
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_field_visible ON zenithjoy.field_definitions(is_visible) WHERE is_visible = TRUE;
CREATE INDEX IF NOT EXISTS idx_field_order ON zenithjoy.field_definitions(display_order);

-- 注释
COMMENT ON TABLE zenithjoy.field_definitions IS '字段定义表：存储用户自定义的字段配置';
COMMENT ON COLUMN zenithjoy.field_definitions.field_name IS '字段名称（唯一）';
COMMENT ON COLUMN zenithjoy.field_definitions.field_type IS '字段类型：text/select/multiselect/date/number/checkbox';
COMMENT ON COLUMN zenithjoy.field_definitions.options IS '单选/多选类型的选项（JSONB 数组）';

-- ==================== Insert Default Field Definitions ====================
-- 插入预设字段

INSERT INTO zenithjoy.field_definitions (field_name, field_type, options, display_order)
VALUES
    ('标签', 'multiselect', '["创作系统", "执行系统", "趋势判断", "生活场景"]'::jsonb, 1),
    ('优先级', 'select', '["高", "中", "低"]'::jsonb, 2),
    ('内部笔记', 'textarea', NULL, 3),
    ('目标受众', 'text', NULL, 4)
ON CONFLICT (field_name) DO NOTHING;

-- ==================== Extend platform_posts Table ====================
-- 扩展 platform_posts 表，添加 work_id 字段

-- 注意：这个表可能在不同的 schema 或数据库中
-- 如果表不存在，这个 ALTER 会失败，但不影响其他表的创建

DO $$
BEGIN
    -- 检查表是否存在
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_posts'
    ) THEN
        -- 添加 work_id 字段（如果不存在）
        IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_posts'
            AND column_name = 'work_id'
        ) THEN
            ALTER TABLE public.platform_posts ADD COLUMN work_id UUID;

            -- 创建索引
            CREATE INDEX IF NOT EXISTS idx_platform_posts_work ON public.platform_posts(work_id);

            RAISE NOTICE 'Added work_id column to platform_posts table';
        ELSE
            RAISE NOTICE 'Column work_id already exists in platform_posts table';
        END IF;
    ELSE
        RAISE NOTICE 'Table platform_posts does not exist, skipping';
    END IF;
END $$;

-- ==================== Grant Permissions ====================
-- 授予权限（如果需要）

-- GRANT SELECT, INSERT, UPDATE, DELETE ON zenithjoy.works TO your_api_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON zenithjoy.publish_logs TO your_api_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON zenithjoy.field_definitions TO your_api_user;

COMMIT;

-- ==================== Verification Queries ====================
-- 验证查询（可选执行）

-- 查看创建的表
-- SELECT table_name, table_type
-- FROM information_schema.tables
-- WHERE table_schema = 'zenithjoy'
-- ORDER BY table_name;

-- 查看 works 表结构
-- \d zenithjoy.works

-- 查看 publish_logs 表结构
-- \d zenithjoy.publish_logs

-- 查看 field_definitions 表结构
-- \d zenithjoy.field_definitions

-- 查看预设字段
-- SELECT * FROM zenithjoy.field_definitions ORDER BY display_order;

-- ==================== Success ====================
SELECT '✅ Migration 002 completed successfully: works, publish_logs, field_definitions tables created' AS status;
