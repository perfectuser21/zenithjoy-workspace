#!/usr/bin/env python3
"""从 Notion 同步所有页面的标题和内容到本地数据库"""

import os
import sys
import json
import sqlite3
import httpx
import asyncio
from pathlib import Path
from datetime import datetime

# 配置
DB_PATH = Path(__file__).parent.parent / "data" / "creator.db"
NOTION_DB_ID = "a5e419c5f8c54452a6678419a25b9d17"

def get_notion_token():
    """获取 Notion token"""
    cred_file = Path.home() / ".credentials" / "notion.env"
    if cred_file.exists():
        for line in cred_file.read_text().splitlines():
            if line.startswith("NOTION_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None

def init_db():
    """确保数据库有正确的表结构"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 检查是否有 notion_id 列
    c.execute("PRAGMA table_info(works)")
    columns = [col[1] for col in c.fetchall()]

    if 'notion_id' not in columns:
        c.execute('ALTER TABLE works ADD COLUMN notion_id TEXT')
    if 'status' not in columns:
        c.execute('ALTER TABLE works ADD COLUMN status TEXT DEFAULT "未开始"')

    conn.commit()
    conn.close()

async def fetch_all_notion_pages(token: str, since_date: str = "2025-11-01"):
    """获取 Notion 数据库中指定日期之后的页面"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }

    all_pages = []
    has_more = True
    start_cursor = None

    async with httpx.AsyncClient(timeout=60) as client:
        while has_more:
            body = {
                "page_size": 100,
                "filter": {
                    "property": "添加日期",
                    "created_time": {
                        "on_or_after": since_date
                    }
                }
            }
            if start_cursor:
                body["start_cursor"] = start_cursor

            resp = await client.post(
                f"https://api.notion.com/v1/databases/{NOTION_DB_ID}/query",
                headers=headers,
                json=body
            )

            if resp.status_code != 200:
                print(f"Error fetching pages: {resp.status_code}")
                print(resp.text)
                break

            data = resp.json()
            all_pages.extend(data.get("results", []))
            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

            print(f"  Fetched {len(all_pages)} pages...")

    return all_pages

async def fetch_page_blocks(client, token: str, page_id: str):
    """获取页面的所有 blocks（递归获取子 blocks）"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28"
    }

    all_blocks = []

    async def get_children(block_id: str, depth: int = 0):
        if depth > 3:  # 防止无限递归
            return

        resp = await client.get(
            f"https://api.notion.com/v1/blocks/{block_id}/children?page_size=100",
            headers=headers
        )

        if resp.status_code != 200:
            return

        data = resp.json()
        for block in data.get("results", []):
            all_blocks.append(block)

            # 递归获取子 blocks
            if block.get("has_children"):
                await get_children(block["id"], depth + 1)

    await get_children(page_id)
    return all_blocks

def extract_text_from_blocks(blocks):
    """从 blocks 中提取纯文本"""
    text_parts = []

    for block in blocks:
        block_type = block.get("type", "")
        block_data = block.get(block_type, {})

        # 获取 rich_text
        rich_text = block_data.get("rich_text", [])
        if rich_text:
            text = "".join(rt.get("plain_text", "") for rt in rich_text)
            if text.strip():
                text_parts.append(text)

        # 处理特殊类型
        if block_type == "divider":
            text_parts.append("---")

    return "\n\n".join(text_parts)

def parse_page_properties(page):
    """解析页面属性"""
    props = page.get("properties", {})

    # 标题
    title_prop = props.get("标题", {}).get("title", [])
    title = title_prop[0]["plain_text"] if title_prop else "Untitled"

    # 状态
    status_prop = props.get("发布状态", {}).get("status", {})
    status = status_prop.get("name", "未开始") if status_prop else "未开始"

    # 类型
    type_prop = props.get("内容形态", {}).get("select", {})
    content_type = type_prop.get("name", "") if type_prop else ""

    # 日期
    date_prop = props.get("发布", {}).get("date", {})
    publish_date = date_prop.get("start", "") if date_prop else ""

    # 爆款
    is_hit = props.get("爆款", {}).get("checkbox", False)

    # 精品
    is_premium = props.get("精品", {}).get("checkbox", False)

    return {
        "title": title,
        "status": status,
        "type": content_type,
        "date": publish_date or page.get("created_time", "")[:10],
        "is_hit": is_hit,
        "is_premium": is_premium,
        "notion_id": page["id"],
        "url": page.get("url", "")
    }

async def sync_all():
    """同步所有 Notion 页面到本地数据库"""
    token = get_notion_token()
    if not token:
        print("Error: Notion token not found")
        return

    print("Initializing database...")
    init_db()

    print("Fetching all pages from Notion...")
    pages = await fetch_all_notion_pages(token)
    print(f"Found {len(pages)} pages")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 清空现有数据（或者用 upsert）
    c.execute("DELETE FROM works")

    async with httpx.AsyncClient(timeout=60) as client:
        for i, page in enumerate(pages):
            props = parse_page_properties(page)

            print(f"[{i+1}/{len(pages)}] {props['title'][:40]}...")

            # 获取页面内容
            try:
                blocks = await fetch_page_blocks(client, token, page["id"])
                content = extract_text_from_blocks(blocks)
                word_count = len(content.replace(" ", "").replace("\n", ""))
            except Exception as e:
                print(f"  Error fetching blocks: {e}")
                content = ""
                word_count = 0

            # 生成 ID
            date_str = props["date"][:10] if props["date"] else datetime.now().strftime("%Y-%m-%d")
            work_id = f"{date_str}-{props['title'][:50]}"

            # 类型映射
            # 短贴 → short-posts
            # 深度帖 → deep-posts (含 broad-posts)
            # 日常文章 → explainer
            # 深度文章 → newsletter
            # 短视频 → video-script
            type_map = {
                "短贴": "short-posts",
                "深度帖": "deep-posts",
                "日常文章": "explainer",
                "深度文章": "newsletter",
                "短视频": "video-script"
            }
            work_type = type_map.get(props["type"], "deep-posts")

            # 插入数据库
            c.execute('''
                INSERT OR REPLACE INTO works
                (id, title, type, content, excerpt, word_count, can_upgrade, created_at, updated_at, notion_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                work_id,
                props["title"],
                work_type,
                content,
                content[:200] if content else "",
                word_count,
                1 if props["is_hit"] else 0,
                props["date"],
                datetime.now().isoformat(),
                props["notion_id"],
                props["status"]
            ))

            # 每 10 个提交一次
            if (i + 1) % 10 == 0:
                conn.commit()

    conn.commit()
    conn.close()

    print(f"\nDone! Synced {len(pages)} pages to local database.")

if __name__ == "__main__":
    asyncio.run(sync_all())
