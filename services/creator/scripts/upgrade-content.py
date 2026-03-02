#!/usr/bin/env python3
"""
内容升级工具

用法:
  python3 upgrade-content.py list
  python3 upgrade-content.py upgrade <file> <target>

target: newsletter, explainer, video-script
"""
import os, sys, json
from datetime import datetime

TYPE_MAP = {
    'newsletter': ('newsletters', 'Newsletter'),
    'explainer': ('explainers', 'Explainer'),
    'video-script': ('video-scripts', 'Video Script'),
}

def parse_frontmatter(content):
    if not content.startswith('---'):
        return {}, content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}, content
    fm = {}
    for line in parts[1].strip().split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            fm[k.strip()] = v.strip().strip('"\'')
    return fm, parts[2]

def list_upgradeable():
    with open('data/works-index.json', 'r') as f:
        index = json.load(f)
    
    print("=== 可升级的爆款内容 ===\n")
    i = 0
    for w in index['works']:
        if w['is_hit'] and w['content_type'] in ['deep-posts', 'broad-posts'] and w['upgrade_status'] != 'upgraded':
            i += 1
            targets = "Newsletter, Video Script" if w['content_type'] == 'deep-posts' else "Explainer, Video Script"
            print(f"{i}. [{w['label']}] {w['title']}")
            print(f"   → 可升级为: {targets}")
            print(f"   文件: {w['file']}\n")

def upgrade(src, target):
    if target not in TYPE_MAP:
        print(f"错误: 未知类型 '{target}'. 可用: {', '.join(TYPE_MAP.keys())}")
        return
    
    target_dir, label = TYPE_MAP[target]
    
    with open(src, 'r', encoding='utf-8') as f:
        content = f.read()
    fm, body = parse_frontmatter(content)
    
    filename = os.path.basename(src)
    dst = f"content/{target_dir}/{filename}"
    
    new_content = f"""---
title: "{fm.get('title', '')}"
date: {datetime.now().strftime('%Y-%m-%d')}
type: {label}
upgraded_from: {src}
original_date: {fm.get('date', '')}
status: 草稿
---
{body}
"""
    os.makedirs(f"content/{target_dir}", exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"✅ 升级完成: {src} → {dst}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: upgrade-content.py list | upgrade <file> <target>")
    elif sys.argv[1] == 'list':
        list_upgradeable()
    elif sys.argv[1] == 'upgrade' and len(sys.argv) >= 4:
        upgrade(sys.argv[2], sys.argv[3])
