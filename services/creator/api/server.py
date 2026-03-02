#!/usr/bin/env python3
"""作品库 API 服务"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime
import uvicorn
import httpx

# Notion API - 从环境变量或凭据文件读取
def get_notion_token():
    # 先尝试环境变量
    token = os.environ.get("NOTION_API_KEY")
    if token:
        return token
    # 从凭据文件读取
    cred_file = Path.home() / ".credentials" / "notion.env"
    if cred_file.exists():
        for line in cred_file.read_text().splitlines():
            if line.startswith("NOTION_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None

NOTION_DB_ID = "a5e419c5f8c54452a6678419a25b9d17"

app = FastAPI(title="ZenithJoy Creator API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).parent.parent / "data" / "creator.db"
CONTENT_DIR = Path(__file__).parent.parent / "content"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """确保数据库表存在"""
    conn = get_db()
    c = conn.cursor()

    # 作品表
    c.execute('''
        CREATE TABLE IF NOT EXISTS works (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT,
            excerpt TEXT,
            word_count INTEGER DEFAULT 0,
            tags TEXT,
            source_file TEXT,
            can_upgrade INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
        )
    ''')

    # 平台表
    c.execute('''
        CREATE TABLE IF NOT EXISTS platforms (
            id TEXT PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            icon TEXT,
            sort_order INTEGER DEFAULT 0
        )
    ''')

    # 发布记录
    c.execute('''
        CREATE TABLE IF NOT EXISTS publications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_id TEXT NOT NULL,
            platform_id TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            url TEXT,
            published_at TEXT,
            metrics TEXT,
            FOREIGN KEY (work_id) REFERENCES works(id),
            UNIQUE(work_id, platform_id)
        )
    ''')

    # 自定义属性
    c.execute('''
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            type TEXT DEFAULT 'text',
            options TEXT,
            visible INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0
        )
    ''')

    # 作品属性值
    c.execute('''
        CREATE TABLE IF NOT EXISTS work_properties (
            work_id TEXT NOT NULL,
            property_id INTEGER NOT NULL,
            value TEXT,
            PRIMARY KEY (work_id, property_id),
            FOREIGN KEY (work_id) REFERENCES works(id),
            FOREIGN KEY (property_id) REFERENCES properties(id)
        )
    ''')

    # 用户设置（列显示等）
    c.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    conn.commit()

    # 初始化平台
    platforms = [
        ('xiaohongshu', '小红书', '📕', 1),
        ('douyin', '抖音', '🎵', 2),
        ('kuaishou', '快手', '⚡', 3),
        ('shipinhao', '视频号', '📺', 4),
        ('x', 'X', '𝕏', 5),
        ('toutiao', '头条', '📰', 6),
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

    # 初始化默认属性
    default_props = [
        ('type', 'select', '["deep-posts","broad-posts","short-posts"]', 1, 1),
        ('date', 'date', None, 1, 2),
        ('word_count', 'number', None, 1, 3),
        ('can_upgrade', 'checkbox', None, 1, 4),
        ('platforms', 'multi_select', None, 1, 5),
    ]
    for name, ptype, options, visible, order in default_props:
        c.execute('''
            INSERT OR IGNORE INTO properties (name, type, options, visible, sort_order)
            VALUES (?, ?, ?, ?, ?)
        ''', (name, ptype, options, visible, order))

    conn.commit()
    conn.close()

# Models
class WorkUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None
    can_upgrade: Optional[bool] = None
    date: Optional[str] = None

class PublicationUpdate(BaseModel):
    status: str  # draft, published, scheduled
    url: Optional[str] = None
    published_at: Optional[str] = None

class PropertyCreate(BaseModel):
    name: str
    type: str = "text"
    options: Optional[List[str]] = None

class PropertyUpdate(BaseModel):
    visible: Optional[bool] = None
    sort_order: Optional[int] = None

class SettingsUpdate(BaseModel):
    visible_columns: Optional[List[str]] = None
    view_mode: Optional[str] = None

# API Routes

@app.get("/api/works")
def list_works():
    """获取所有作品"""
    conn = get_db()
    c = conn.cursor()

    # 获取作品
    c.execute('''
        SELECT id, title, type, excerpt, word_count, can_upgrade, created_at, updated_at, source_file
        FROM works ORDER BY created_at DESC
    ''')
    works = []
    for row in c.fetchall():
        work = dict(row)
        work['can_upgrade'] = bool(work['can_upgrade'])

        # 获取发布状态
        c.execute('''
            SELECT platform_id, status, url, published_at
            FROM publications WHERE work_id = ?
        ''', (work['id'],))
        work['publications'] = {r['platform_id']: dict(r) for r in c.fetchall()}

        works.append(work)

    conn.close()
    return {"works": works, "total": len(works)}

@app.get("/api/works/{work_id}")
def get_work(work_id: str):
    """获取单个作品详情"""
    conn = get_db()
    c = conn.cursor()

    c.execute('SELECT * FROM works WHERE id = ?', (work_id,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Work not found")

    work = dict(row)
    work['can_upgrade'] = bool(work['can_upgrade'])

    # 如果没有 content，从文件读取
    if not work.get('content') and work.get('source_file'):
        try:
            with open(work['source_file'], 'r', encoding='utf-8') as f:
                content = f.read()
                # 去掉 frontmatter
                if content.startswith('---'):
                    parts = content.split('---', 2)
                    if len(parts) >= 3:
                        work['content'] = parts[2].strip()
                    else:
                        work['content'] = content
                else:
                    work['content'] = content
        except:
            work['content'] = ''

    # 获取发布状态
    c.execute('''
        SELECT platform_id, status, url, published_at
        FROM publications WHERE work_id = ?
    ''', (work_id,))
    work['publications'] = {r['platform_id']: dict(r) for r in c.fetchall()}

    conn.close()
    return work

@app.patch("/api/works/{work_id}")
def update_work(work_id: str, data: WorkUpdate):
    """更新作品"""
    conn = get_db()
    c = conn.cursor()

    # 检查作品是否存在
    c.execute('SELECT id, source_file FROM works WHERE id = ?', (work_id,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Work not found")

    updates = []
    values = []

    if data.title is not None:
        updates.append("title = ?")
        values.append(data.title)
    if data.content is not None:
        updates.append("content = ?")
        values.append(data.content)
        updates.append("word_count = ?")
        values.append(len(data.content.replace(' ', '').replace('\n', '')))
        updates.append("excerpt = ?")
        values.append(data.content[:200])

        # 同步到文件
        source_file = row['source_file']
        if source_file and os.path.exists(source_file):
            try:
                with open(source_file, 'r', encoding='utf-8') as f:
                    old_content = f.read()

                # 保留 frontmatter，更新 body
                if old_content.startswith('---'):
                    parts = old_content.split('---', 2)
                    if len(parts) >= 3:
                        new_content = f"---{parts[1]}---\n\n{data.content}"
                        with open(source_file, 'w', encoding='utf-8') as f:
                            f.write(new_content)
            except Exception as e:
                print(f"Error syncing to file: {e}")

    if data.type is not None:
        updates.append("type = ?")
        values.append(data.type)
    if data.can_upgrade is not None:
        updates.append("can_upgrade = ?")
        values.append(1 if data.can_upgrade else 0)
    if data.date is not None:
        updates.append("created_at = ?")
        values.append(data.date)

    if updates:
        updates.append("updated_at = ?")
        values.append(datetime.now().isoformat())
        values.append(work_id)

        c.execute(f"UPDATE works SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()

    conn.close()
    return {"success": True}

@app.put("/api/works/{work_id}/publications/{platform_id}")
def update_publication(work_id: str, platform_id: str, data: PublicationUpdate):
    """更新发布状态"""
    conn = get_db()
    c = conn.cursor()

    c.execute('''
        INSERT INTO publications (work_id, platform_id, status, url, published_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(work_id, platform_id) DO UPDATE SET
            status = excluded.status,
            url = excluded.url,
            published_at = excluded.published_at
    ''', (work_id, platform_id, data.status, data.url, data.published_at))

    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/platforms")
def list_platforms():
    """获取所有平台"""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM platforms ORDER BY sort_order')
    platforms = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"platforms": platforms}

@app.get("/api/properties")
def list_properties():
    """获取所有属性"""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM properties ORDER BY sort_order')
    props = []
    for row in c.fetchall():
        p = dict(row)
        p['visible'] = bool(p['visible'])
        if p['options']:
            p['options'] = json.loads(p['options'])
        props.append(p)
    conn.close()
    return {"properties": props}

@app.post("/api/properties")
def create_property(data: PropertyCreate):
    """创建新属性"""
    conn = get_db()
    c = conn.cursor()

    options_json = json.dumps(data.options) if data.options else None
    c.execute('''
        INSERT INTO properties (name, type, options, visible, sort_order)
        VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM properties))
    ''', (data.name, data.type, options_json))

    prop_id = c.lastrowid
    conn.commit()
    conn.close()
    return {"id": prop_id, "success": True}

@app.patch("/api/properties/{prop_id}")
def update_property(prop_id: int, data: PropertyUpdate):
    """更新属性"""
    conn = get_db()
    c = conn.cursor()

    updates = []
    values = []

    if data.visible is not None:
        updates.append("visible = ?")
        values.append(1 if data.visible else 0)
    if data.sort_order is not None:
        updates.append("sort_order = ?")
        values.append(data.sort_order)

    if updates:
        values.append(prop_id)
        c.execute(f"UPDATE properties SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()

    conn.close()
    return {"success": True}

@app.get("/api/settings")
def get_settings():
    """获取设置"""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT key, value FROM settings')
    settings = {}
    for row in c.fetchall():
        try:
            settings[row['key']] = json.loads(row['value'])
        except:
            settings[row['key']] = row['value']
    conn.close()
    return settings

@app.patch("/api/settings")
def update_settings(data: Dict[str, Any]):
    """更新设置"""
    conn = get_db()
    c = conn.cursor()

    for key, value in data.items():
        value_json = json.dumps(value) if isinstance(value, (list, dict)) else str(value)
        c.execute('''
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ''', (key, value_json))

    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/notion/page/{notion_id}/blocks")
async def get_notion_blocks(notion_id: str):
    """从 Notion 获取页面 blocks"""
    token = get_notion_token()
    if not token:
        raise HTTPException(status_code=500, detail="Notion token not configured")

    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28"
    }

    async with httpx.AsyncClient() as client:
        # 获取 blocks
        resp = await client.get(
            f"https://api.notion.com/v1/blocks/{notion_id}/children",
            headers=headers
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        data = resp.json()
        blocks = []

        for block in data.get("results", []):
            block_type = block.get("type")
            parsed = {"type": block_type, "id": block.get("id")}

            # 解析不同类型的 block
            if block_type == "paragraph":
                rich_text = block.get("paragraph", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type in ("heading_1", "heading_2", "heading_3"):
                rich_text = block.get(block_type, {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type == "bulleted_list_item":
                rich_text = block.get("bulleted_list_item", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type == "numbered_list_item":
                rich_text = block.get("numbered_list_item", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type == "to_do":
                rich_text = block.get("to_do", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
                parsed["checked"] = block.get("to_do", {}).get("checked", False)
            elif block_type == "toggle":
                rich_text = block.get("toggle", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type == "quote":
                rich_text = block.get("quote", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
            elif block_type == "callout":
                rich_text = block.get("callout", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
                parsed["icon"] = block.get("callout", {}).get("icon", {}).get("emoji", "💡")
            elif block_type == "code":
                rich_text = block.get("code", {}).get("rich_text", [])
                parsed["text"] = "".join(rt.get("plain_text", "") for rt in rich_text)
                parsed["language"] = block.get("code", {}).get("language", "")
            elif block_type == "divider":
                parsed["text"] = "---"
            elif block_type == "image":
                img = block.get("image", {})
                if img.get("type") == "external":
                    parsed["url"] = img.get("external", {}).get("url", "")
                elif img.get("type") == "file":
                    parsed["url"] = img.get("file", {}).get("url", "")
            elif block_type == "table":
                parsed["has_children"] = block.get("has_children", False)
            elif block_type == "column_list":
                parsed["has_children"] = block.get("has_children", False)

            blocks.append(parsed)

        return {"blocks": blocks, "has_more": data.get("has_more", False)}


@app.get("/api/works/{work_id}/notion-content")
async def get_work_notion_content(work_id: str):
    """获取作品的 Notion 内容"""
    conn = get_db()
    c = conn.cursor()

    # 先从本地文件获取 notion_id
    c.execute('SELECT source_file FROM works WHERE id = ?', (work_id,))
    row = c.fetchone()
    conn.close()

    if not row or not row['source_file']:
        raise HTTPException(status_code=404, detail="Work not found")

    # 从 frontmatter 读取 notion_id
    try:
        with open(row['source_file'], 'r', encoding='utf-8') as f:
            content = f.read()

        notion_id = None
        if content.startswith('---'):
            parts = content.split('---', 2)
            if len(parts) >= 2:
                for line in parts[1].splitlines():
                    if line.startswith('notion_id:'):
                        notion_id = line.split(':', 1)[1].strip()
                        break

        if not notion_id:
            return {"blocks": [], "error": "No notion_id in frontmatter"}

        # 调用 Notion API 获取 blocks
        return await get_notion_blocks(notion_id)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/notion/database/pages")
async def get_notion_database_pages(page_size: int = 100):
    """直接从 Notion 数据库获取所有页面"""
    token = get_notion_token()
    if not token:
        raise HTTPException(status_code=500, detail="Notion token not configured")

    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.notion.com/v1/databases/{NOTION_DB_ID}/query",
            headers=headers,
            json={"page_size": page_size}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        data = resp.json()
        pages = []

        for page in data.get("results", []):
            props = page.get("properties", {})

            # 获取标题
            title_prop = props.get("标题", {}).get("title", [])
            title = title_prop[0]["plain_text"] if title_prop else "Untitled"

            # 获取其他属性
            status_prop = props.get("发布状态", {}).get("status", {})
            type_prop = props.get("内容形态", {}).get("select", {})
            date_prop = props.get("发布", {}).get("date", {})
            hit_prop = props.get("爆款", {}).get("checkbox", False)

            pages.append({
                "id": page["id"],
                "title": title,
                "status": status_prop.get("name", "未开始") if status_prop else "未开始",
                "type": type_prop.get("name", "") if type_prop else "",
                "date": date_prop.get("start", "") if date_prop else "",
                "is_hit": hit_prop,
                "created_at": page.get("created_time", ""),
                "url": page.get("url", "")
            })

        return {"pages": pages, "total": len(pages), "has_more": data.get("has_more", False)}


@app.get("/api/stats")
def get_stats():
    """获取统计"""
    conn = get_db()
    c = conn.cursor()

    stats = {}

    c.execute('SELECT COUNT(*) FROM works')
    stats['total'] = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM works WHERE type = 'deep-posts'")
    stats['deep'] = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM works WHERE type = 'broad-posts'")
    stats['broad'] = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM works WHERE type = 'short-posts'")
    stats['short'] = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM works WHERE can_upgrade = 1")
    stats['viral'] = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM publications WHERE status = 'published'")
    stats['published'] = c.fetchone()[0]

    conn.close()
    return stats

# 初始化
init_db()

# 静态文件
parent_dir = Path(__file__).parent.parent
app.mount("/", StaticFiles(directory=str(parent_dir), html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8899)
