#!/usr/bin/env python3
"""
添加原创帖子并自动同步到 NotebookLM
用法: python3 add-original-post.py "标题" "内容" [主题]
"""
import os
import sys
import json
import subprocess
from datetime import datetime

NOTEBOOK_ID = "88c3de81-95b3-44f8-9f2a-27e79537efec"

def add_post(title, content, theme='未分类'):
    timestamp = datetime.now()
    date_str = timestamp.strftime('%Y-%m-%d')
    
    # 生成文件名
    safe_title = title[:30].replace(' ', '-').replace('/', '-').replace('。', '').replace('，', '')
    filename = f"{date_str}-{safe_title}.md"
    filepath = f"content/short-posts/{filename}"
    
    # 生成内容
    md_content = f"""---
title: "{title}"
date: {date_str}
type: 短贴
theme: {theme}
status: 草稿
is_hit: false
is_premium: false
---

中文：

标题：{title}

内容：

{content}

---

英文：

标题：

内容：
"""
    
    # 保存文件
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(md_content)
    
    print(f"✅ 帖子已保存: {filepath}")
    
    # 同步到 NotebookLM
    print("📤 同步到 NotebookLM...")
    try:
        result = subprocess.run(
            ['notebooklm', 'source', 'add', filepath, '--notebook', NOTEBOOK_ID],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            print("✅ 已同步到 NotebookLM")
        else:
            print(f"⚠️ 同步失败: {result.stderr}")
    except Exception as e:
        print(f"⚠️ 同步失败: {e}")
    
    # 更新索引
    subprocess.run(['python3', 'scripts/build-works-index.py'], capture_output=True)
    print("✅ 索引已更新")
    
    return {'success': True, 'file': filepath, 'title': title}

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python3 add-original-post.py \"标题\" \"内容\" [主题]")
        sys.exit(1)
    
    title = sys.argv[1]
    content = sys.argv[2]
    theme = sys.argv[3] if len(sys.argv) > 3 else '未分类'
    
    add_post(title, content, theme)
