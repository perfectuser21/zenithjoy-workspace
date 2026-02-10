# Database Migrations

数据库迁移脚本目录。

## 迁移列表

| 文件 | 版本 | 说明 | 日期 |
|------|------|------|------|
| `001_init.sql` | 001 | 初始化 schema（参考 perfect21-platform） | - |
| `002_create_works_tables.sql` | 002 | 创建作品管理系统表 | 2026-02-10 |

## 执行方法

### 本地开发环境

```bash
# 连接到本地 PostgreSQL
psql -h localhost -U postgres -d cecelia -f docs/database/migrations/002_create_works_tables.sql
```

### 香港生产环境

```bash
# 通过 Tailscale 连接香港 PostgreSQL
ssh hk "docker exec postgres psql -U postgres -d cecelia -f /path/to/002_create_works_tables.sql"

# 或直接执行
psql -h 100.86.118.99 -U postgres -d cecelia -f docs/database/migrations/002_create_works_tables.sql
```

## 验证

### 验证表创建

```sql
-- 查看 zenithjoy schema 的所有表
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'zenithjoy'
ORDER BY table_name;

-- 查看 works 表结构
\d zenithjoy.works

-- 查看 publish_logs 表结构
\d zenithjoy.publish_logs

-- 查看 field_definitions 表结构
\d zenithjoy.field_definitions

-- 查看预设字段
SELECT * FROM zenithjoy.field_definitions ORDER BY display_order;
```

### 验证 platform_posts 扩展

```sql
-- 查看 platform_posts 表结构（检查 work_id 字段）
\d platform_posts

-- 或
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'platform_posts'
AND column_name = 'work_id';
```

## 回滚

如果需要回滚，执行：

```sql
BEGIN;

-- 删除 platform_posts 的 work_id 字段
ALTER TABLE IF EXISTS public.platform_posts DROP COLUMN IF EXISTS work_id;

-- 删除表（注意：会删除所有数据）
DROP TABLE IF EXISTS zenithjoy.field_definitions CASCADE;
DROP TABLE IF EXISTS zenithjoy.publish_logs CASCADE;
DROP TABLE IF EXISTS zenithjoy.works CASCADE;

-- 删除 schema（如果为空）
-- DROP SCHEMA IF EXISTS zenithjoy CASCADE;

COMMIT;
```

## 注意事项

1. **备份数据**：执行前务必备份数据库
2. **测试环境先行**：先在测试环境验证
3. **事务保护**：脚本已包含 BEGIN/COMMIT 事务
4. **幂等性**：使用 `IF NOT EXISTS` 确保可重复执行
5. **权限**：确保执行用户有足够权限

## Schema 设计

### zenithjoy.works

作品表，存储所有内容作品。

**核心字段**：
- `id`: UUID 主键
- `title`: 标题
- `body`: 正文（Markdown）
- `content_type`: 内容类型（text/image/video/article/audio）
- `custom_fields`: 自定义字段（JSONB）

**特性**：
- 支持富文本内容
- 支持媒体文件（图片/视频）
- 支持平台链接
- 支持自定义字段（前台可增删）

### zenithjoy.publish_logs

发布日志表，记录作品发布到各平台的历史。

**核心字段**：
- `work_id`: 关联作品
- `platform`: 发布平台
- `platform_post_id`: 平台返回的作品 ID
- `status`: 发布状态

**特性**：
- 一个作品可发布到多个平台
- 唯一约束：同一作品在同一平台只能有一条记录
- 支持发布状态追踪

### zenithjoy.field_definitions

字段定义表，存储用户自定义的字段配置。

**核心字段**：
- `field_name`: 字段名称（唯一）
- `field_type`: 字段类型
- `options`: 选项（JSONB，用于单选/多选）

**特性**：
- 支持 7 种字段类型
- 用户可在前台增删字段
- 预设 4 个默认字段

### platform_posts 扩展

为现有的 `platform_posts` 表添加 `work_id` 字段，用于关联到作品表。

**关联关系**：
```
works (作品) → publish_logs (发布) → platform_posts (数据追踪)
     1              N                        N
```

## 相关文档

- PRD: `/.prd-works-management.md`
- DoD: `/.dod-cp-20260210-works-database-schema.md`
- Perfect21 Platform Schema: `/home/xx/dev/perfect21-platform/docs/database/SCHEMA.md`
