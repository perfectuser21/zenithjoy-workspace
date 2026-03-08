#!/usr/bin/env python3
"""
构建作品索引 - 内容升级体系

内容体系:
- short-posts: Short Post (短贴) - 刷存在感，独立存在
- deep-posts: Deep Post (深度帖) → 升级为 Newsletter
- broad-posts: Broad Post (广度帖) → 升级为 Explainer
- newsletters: Newsletter (深度帖升级)
- explainers: Explainer (科普长文，广度帖升级)
- video-scripts: Video Script (短视频脚本)
- ai-generated: AI 生成的金句
"""
import os
import json
import glob
from datetime import datetime

CONTENT_TYPES = {
    'short-posts': {
        'label': 'Short Post',
        'label_cn': '短贴',
        'source': 'original',
        'description': '刷存在感',
        'can_upgrade_to': []
    },
    'deep-posts': {
        'label': 'Deep Post',
        'label_cn': '深度帖',
        'source': 'original',
        'description': '深入一个话题',
        'can_upgrade_to': ['newsletters', 'video-scripts']
    },
    'broad-posts': {
        'label': 'Broad Post',
        'label_cn': '广度帖',
        'source': 'original',
        'description': '广泛覆盖一个领域',
        'can_upgrade_to': ['explainers', 'video-scripts']
    },
    'newsletters': {
        'label': 'Newsletter',
        'label_cn': 'Newsletter',
        'source': 'original',
        'description': '深度帖升级',
        'upgraded_from': 'deep-posts',
        'can_upgrade_to': []
    },
    'explainers': {
        'label': 'Explainer',
        'label_cn': '科普长文',
        'source': 'original',
        'description': '广度帖升级',
        'upgraded_from': 'broad-posts',
        'can_upgrade_to': []
    },
    'video-scripts': {
        'label': 'Video Script',
        'label_cn': '短视频脚本',
        'source': 'original',
        'description': '深度帖/广度帖升级',
        'upgraded_from': ['deep-posts', 'broad-posts'],
        'can_upgrade_to': []
    },
    'ai-generated': {
        'label': 'AI Quote',
        'label_cn': 'AI金句',
        'source': 'ai',
        'description': 'AI 生成',
        'can_upgrade_to': []
    }
}

def parse_frontmatter(content):
    if not content.startswith('---'):
        return {}, content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}, content
    frontmatter = {}
    for line in parts[1].strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip().strip('"\'')
    return frontmatter, parts[2]

def build_index():
    works = []
    
    for content_dir, config in CONTENT_TYPES.items():
        dir_path = f'content/{content_dir}'
        if not os.path.exists(dir_path):
            continue
        for filepath in glob.glob(f'{dir_path}/*.md'):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                fm, body = parse_frontmatter(content)
                works.append({
                    'id': fm.get('notion_id', fm.get('id', os.path.basename(filepath))),
                    'title': fm.get('title', os.path.basename(filepath).replace('.md', '')),
                    'source': config['source'],
                    'content_type': content_dir,
                    'label': config['label'],
                    'label_cn': config['label_cn'],
                    'date': fm.get('date', ''),
                    'theme': fm.get('theme', ''),
                    'is_hit': str(fm.get('is_hit', 'false')).lower() == 'true',
                    'upgrade_status': fm.get('upgrade_status', 'none'),
                    'upgraded_to': fm.get('upgraded_to', None),
                    'file': filepath,
                })
            except Exception as e:
                print(f"Warning: {filepath}: {e}")
    
    stats = {'total': len(works), 'by_type': {}, 'upgradeable': 0}
    for w in works:
        t = w['label']
        stats['by_type'][t] = stats['by_type'].get(t, 0) + 1
        if w['is_hit'] and w['content_type'] in ['deep-posts', 'broad-posts']:
            stats['upgradeable'] += 1
    
    index = {
        'updated_at': datetime.now().isoformat(),
        'content_types': CONTENT_TYPES,
        'stats': stats,
        'works': sorted(works, key=lambda x: x['date'] or '', reverse=True)
    }
    
    os.makedirs('data', exist_ok=True)
    with open('data/works-index.json', 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    
    print("✅ 索引已更新")
    print(f"   总计: {stats['total']}")
    for t, c in stats['by_type'].items():
        print(f"   • {t}: {c}")
    print(f"   可升级 (爆款): {stats['upgradeable']}")

if __name__ == '__main__':
    build_index()
