#!/usr/bin/env python3
"""初始化作品库数据库"""

import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "data" / "creator.db"
CONTENT_DIR = Path(__file__).parent.parent / "content"

def init_db():
    """创建数据库表"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 作品表
    c.execute('''
        CREATE TABLE IF NOT EXISTS works (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL,  -- deep-post, broad-post, short-post
            content TEXT,
            excerpt TEXT,
            word_count INTEGER DEFAULT 0,
            tags TEXT,  -- JSON array
            source_file TEXT,
            can_upgrade INTEGER DEFAULT 0,  -- 是否爆款可升级
            upgrade_to TEXT,  -- 升级为什么类型
            created_at TEXT,
            updated_at TEXT
        )
    ''')

    # 平台表
    c.execute('''
        CREATE TABLE IF NOT EXISTS platforms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            icon TEXT,
            api_enabled INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        )
    ''')

    # 发布记录表
    c.execute('''
        CREATE TABLE IF NOT EXISTS publications (
            id TEXT PRIMARY KEY,
            work_id TEXT NOT NULL,
            platform_id TEXT NOT NULL,
            variant_id TEXT,  -- AI 改写版本 ID（NULL 表示原版）
            published_at TEXT,
            url TEXT,
            status TEXT DEFAULT 'draft',  -- draft, published, scheduled, deleted
            notes TEXT,
            FOREIGN KEY (work_id) REFERENCES works(id),
            FOREIGN KEY (platform_id) REFERENCES platforms(id)
        )
    ''')

    # 数据表现表（每日快照）
    c.execute('''
        CREATE TABLE IF NOT EXISTS metrics (
            id TEXT PRIMARY KEY,
            publication_id TEXT NOT NULL,
            date TEXT NOT NULL,
            views INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            saves INTEGER DEFAULT 0,
            followers_gained INTEGER DEFAULT 0,
            FOREIGN KEY (publication_id) REFERENCES publications(id),
            UNIQUE(publication_id, date)
        )
    ''')

    # AI 改写版本表
    c.execute('''
        CREATE TABLE IF NOT EXISTS variants (
            id TEXT PRIMARY KEY,
            work_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            hook_type TEXT,  -- 改写角度：hook, angle, emotion, case
            created_at TEXT,
            used_count INTEGER DEFAULT 0,
            FOREIGN KEY (work_id) REFERENCES works(id)
        )
    ''')

    conn.commit()
    print("✅ 数据库表已创建")

    # 初始化平台
    platforms = [
        ('xiaohongshu', '小红书', '📕', 1),
        ('douyin', '抖音', '🎵', 2),
        ('kuaishou', '快手', '⚡', 3),
        ('shipinhao', '视频号', '📺', 4),
        ('x', 'X (Twitter)', '𝕏', 5),
        ('toutiao', '今日头条', '📰', 6),
        ('weibo', '微博', '🔴', 7),
        ('wechat', '公众号', '💚', 8),
        ('zhihu', '知乎', '🔵', 9),
        ('bilibili', 'B站', '📹', 10),
    ]

    for code, name, icon, order in platforms:
        c.execute('''
            INSERT OR IGNORE INTO platforms (id, code, name, icon, sort_order)
            VALUES (?, ?, ?, ?, ?)
        ''', (code, code, name, icon, order))

    conn.commit()
    print(f"✅ 已初始化 {len(platforms)} 个平台")

    return conn

def import_works(conn):
    """导入现有作品"""
    c = conn.cursor()
    imported = 0

    type_mapping = {
        'deep-posts': 'deep-post',
        'broad-posts': 'broad-post',
        'short-posts': 'short-post',
        'ai-generated': 'ai-generated'
    }

    for content_type in ['deep-posts', 'broad-posts', 'short-posts', 'ai-generated']:
        content_dir = CONTENT_DIR / content_type
        if not content_dir.exists():
            continue

        for filepath in content_dir.glob('*.md'):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            # 解析 frontmatter
            title = ''
            tags = []
            date = ''
            can_upgrade = False

            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    frontmatter = parts[1]
                    body = parts[2].strip()

                    for line in frontmatter.split('\n'):
                        if line.startswith('title:'):
                            title = line.split(':', 1)[1].strip().strip('"\'')
                        elif line.startswith('tags:'):
                            tags_str = line.split(':', 1)[1].strip()
                            if tags_str.startswith('['):
                                tags = json.loads(tags_str)
                        elif line.startswith('date:'):
                            date = line.split(':', 1)[1].strip()
                        elif 'viral' in line.lower() or 'upgrade' in line.lower():
                            can_upgrade = True
                else:
                    body = content
            else:
                body = content

            if not title:
                title = filepath.stem

            # 生成 ID
            work_id = filepath.stem
            word_count = len(body.replace(' ', '').replace('\n', ''))
            excerpt = body[:200] if body else ''

            # 检查是否爆款（基于之前的分析）
            # 这里可以根据标签或其他逻辑判断

            c.execute('''
                INSERT OR REPLACE INTO works
                (id, title, type, content, excerpt, word_count, tags, source_file, can_upgrade, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                work_id,
                title,
                type_mapping.get(content_type, content_type),
                body,
                excerpt,
                word_count,
                json.dumps(tags, ensure_ascii=False),
                str(filepath),
                1 if can_upgrade else 0,
                date or datetime.now().isoformat()[:10],
                datetime.now().isoformat()
            ))
            imported += 1

    conn.commit()
    print(f"✅ 已导入 {imported} 篇作品")

    # 标记可升级的爆款
    # 读取 works-index.json 获取 can_upgrade 信息
    index_path = CONTENT_DIR.parent / "data" / "works-index.json"
    if index_path.exists():
        with open(index_path, 'r', encoding='utf-8') as f:
            index_data = json.load(f)

        upgrade_count = 0
        for type_key, works in index_data.get('works', {}).items():
            for work in works:
                if work.get('can_upgrade'):
                    # 根据文件名匹配
                    filename = work.get('file', '').replace('.md', '')
                    if filename:
                        c.execute('UPDATE works SET can_upgrade = 1 WHERE id LIKE ?', (f'%{filename}%',))
                        upgrade_count += 1

        conn.commit()
        print(f"✅ 已标记 {upgrade_count} 篇可升级爆款")

def show_stats(conn):
    """显示统计"""
    c = conn.cursor()

    print("\n📊 作品库统计")
    print("=" * 40)

    c.execute('SELECT type, COUNT(*) FROM works GROUP BY type')
    for row in c.fetchall():
        print(f"  {row[0]}: {row[1]} 篇")

    c.execute('SELECT COUNT(*) FROM works WHERE can_upgrade = 1')
    print(f"  可升级爆款: {c.fetchone()[0]} 篇")

    c.execute('SELECT COUNT(*) FROM platforms')
    print(f"\n📱 平台: {c.fetchone()[0]} 个")

    c.execute('SELECT name FROM platforms ORDER BY sort_order')
    platforms = [row[0] for row in c.fetchall()]
    print(f"  {', '.join(platforms)}")

if __name__ == '__main__':
    print("🚀 初始化作品库数据库...\n")
    conn = init_db()
    import_works(conn)
    show_stats(conn)
    conn.close()
    print(f"\n✅ 数据库位置: {DB_PATH}")
