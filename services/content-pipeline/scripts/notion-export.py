#!/usr/bin/env python3
"""
Notion 作品库导出工具
将 Notion 内容导出为 Markdown 文件
"""

import json
import os
import re
import requests
from datetime import datetime

# 从环境变量或配置文件读取 API Key
def get_notion_api_key():
    """从 ~/.credentials/notion.env 读取 API Key"""
    config_path = os.path.expanduser("~/.credentials/notion.env")
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            for line in f:
                if line.startswith("NOTION_API_KEY="):
                    return line.strip().split("=", 1)[1]
    # 回退到环境变量
    return os.environ.get("NOTION_API_KEY", "")

NOTION_API_KEY = get_notion_api_key()
HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

DATABASE_ID = "a5e419c5-f8c5-4452-a667-8419a25b9d17"
BASE_DIR = "/home/xx/dev/zenithjoy-creator/content"

# 内容形态 -> 目录映射
TYPE_MAP = {
    "深度帖": "deep-posts",
    "短贴": "short-posts",
    "深度文章": "articles",
    "日常文章": "articles",
}


def query_database(start_cursor=None):
    """查询数据库，获取 2025年11月后的未归档内容"""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"

    payload = {
        "page_size": 100,
        "filter": {
            "and": [
                {
                    "property": "归档",
                    "checkbox": {"equals": False}
                },
                {
                    "property": "添加日期",
                    "created_time": {"on_or_after": "2025-11-01"}
                }
            ]
        },
        "sorts": [
            {"property": "添加日期", "direction": "ascending"}
        ]
    }

    if start_cursor:
        payload["start_cursor"] = start_cursor

    response = requests.post(url, headers=HEADERS, json=payload)
    if response.status_code != 200:
        print(f"查询失败: {response.status_code}")
        print(response.text)
        return {"results": [], "has_more": False}

    return response.json()


def get_page_content(page_id):
    """获取页面所有 blocks"""
    url = f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=100"
    response = requests.get(url, headers=HEADERS)
    if response.status_code != 200:
        return []
    return response.json().get("results", [])


def blocks_to_markdown(blocks):
    """将 blocks 转换为 Markdown"""
    lines = []
    prev_type = None

    for block in blocks:
        block_type = block.get("type")

        # 列表项之间不加空行，列表结束后加空行
        if prev_type in ["bulleted_list_item", "numbered_list_item"] and block_type not in ["bulleted_list_item", "numbered_list_item"]:
            lines.append("")

        if block_type == "paragraph":
            texts = block.get("paragraph", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            if text:
                lines.append(text)
                lines.append("")

        elif block_type == "heading_1":
            texts = block.get("heading_1", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"# {text}")
            lines.append("")

        elif block_type == "heading_2":
            texts = block.get("heading_2", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"## {text}")
            lines.append("")

        elif block_type == "heading_3":
            texts = block.get("heading_3", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"### {text}")
            lines.append("")

        elif block_type == "bulleted_list_item":
            texts = block.get("bulleted_list_item", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"- {text}")

        elif block_type == "numbered_list_item":
            texts = block.get("numbered_list_item", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"1. {text}")

        elif block_type == "quote":
            texts = block.get("quote", {}).get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"> {text}")
            lines.append("")

        elif block_type == "divider":
            lines.append("---")
            lines.append("")

        elif block_type == "image":
            image = block.get("image", {})
            url = image.get("file", {}).get("url") or image.get("external", {}).get("url")
            if url:
                lines.append(f"![image]({url})")
                lines.append("")

        elif block_type == "code":
            code = block.get("code", {})
            texts = code.get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lang = code.get("language", "")
            lines.append(f"```{lang}")
            lines.append(text)
            lines.append("```")
            lines.append("")

        elif block_type == "callout":
            callout = block.get("callout", {})
            texts = callout.get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            icon = callout.get("icon", {})
            emoji = icon.get("emoji", "") if icon.get("type") == "emoji" else ""
            lines.append(f"> {emoji} {text}")
            lines.append("")

        elif block_type == "toggle":
            toggle = block.get("toggle", {})
            texts = toggle.get("rich_text", [])
            text = "".join([t.get("plain_text", "") for t in texts])
            lines.append(f"<details>")
            lines.append(f"<summary>{text}</summary>")
            lines.append("</details>")
            lines.append("")

        prev_type = block_type

    return "\n".join(lines)


def sanitize_filename(title):
    """清理文件名"""
    # 移除或替换不合法字符
    title = re.sub(r'[<>:"/\\|?*]', '', title)
    title = re.sub(r'\s+', ' ', title)
    title = title.strip()
    # 限制长度
    if len(title) > 50:
        title = title[:50].strip()
    return title


def export_page(item):
    """导出单个页面"""
    props = item["properties"]
    page_id = item["id"]

    # 获取标题
    title_arr = props.get("标题", {}).get("title", [])
    title = title_arr[0].get("plain_text", "无标题") if title_arr else "无标题"

    # 获取内容形态
    ct = props.get("内容形态", {}).get("select")
    content_type = ct.get("name") if ct else "深度帖"

    # 获取日期
    created = props.get("添加日期", {}).get("created_time", "")[:10]

    # 获取其他属性
    theme_sel = props.get("内容主题", {}).get("select")
    theme = theme_sel.get("name") if theme_sel else ""

    is_hit = props.get("爆款", {}).get("checkbox", False)
    is_premium = props.get("精品", {}).get("checkbox", False)
    status = props.get("发布状态", {}).get("status", {}).get("name", "")

    # 确定目录
    dir_name = TYPE_MAP.get(content_type, "deep-posts")
    output_dir = os.path.join(BASE_DIR, dir_name)
    os.makedirs(output_dir, exist_ok=True)

    # 获取内容
    blocks = get_page_content(page_id)
    content = blocks_to_markdown(blocks)

    # 生成 frontmatter
    frontmatter = f"""---
title: "{title}"
date: {created}
type: {content_type}
theme: {theme}
status: {status}
is_hit: {str(is_hit).lower()}
is_premium: {str(is_premium).lower()}
notion_id: {page_id}
---

"""

    # 生成文件名
    safe_title = sanitize_filename(title)
    filename = f"{created}-{safe_title}.md"
    filepath = os.path.join(output_dir, filename)

    # 写入文件
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter)
        f.write(content)

    return {
        "title": title,
        "type": content_type,
        "file": filepath
    }


def main():
    if not NOTION_API_KEY:
        print("错误: 未找到 Notion API Key")
        print("请确保 ~/.credentials/notion.env 存在且包含 NOTION_API_KEY=...")
        return

    print("开始从 Notion 导出作品...\n")

    all_results = []
    cursor = None

    # 分页获取所有数据
    while True:
        data = query_database(cursor)
        results = data.get("results", [])
        all_results.extend(results)

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    print(f"共找到 {len(all_results)} 条内容\n")
    print("=" * 60)

    exported = []
    for i, item in enumerate(all_results):
        try:
            result = export_page(item)
            exported.append(result)
            print(f"[{i+1}/{len(all_results)}] + {result['type']}: {result['title'][:35]}")
        except Exception as e:
            title_arr = item.get("properties", {}).get("标题", {}).get("title", [])
            title = title_arr[0].get("plain_text", "无标题") if title_arr else "无标题"
            print(f"[{i+1}/{len(all_results)}] x 失败: {title[:35]} - {e}")

    print("\n" + "=" * 60)
    print(f"导出完成! 共 {len(exported)} 条")

    # 统计
    stats = {}
    for item in exported:
        t = item["type"]
        stats[t] = stats.get(t, 0) + 1

    print("\n按类型统计:")
    for k, v in stats.items():
        print(f"  {k}: {v} 条")

    # 输出目录信息
    print("\n文件位置:")
    for dir_name in ["deep-posts", "short-posts", "articles"]:
        dir_path = os.path.join(BASE_DIR, dir_name)
        if os.path.exists(dir_path):
            count = len([f for f in os.listdir(dir_path) if f.endswith('.md')])
            print(f"  {dir_path}: {count} 个文件")


if __name__ == "__main__":
    main()
