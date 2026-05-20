#!/usr/bin/env python3
"""
同步新原创内容到 NotebookLM
检查 content/short-posts/ 中的新文件，添加到 NotebookLM
"""
import os
import json
import glob
import subprocess
from datetime import datetime

NOTEBOOK_ID = "88c3de81-95b3-44f8-9f2a-27e79537efec"
SYNC_STATE_FILE = "data/.notebooklm-sync-state.json"

def load_sync_state():
    if os.path.exists(SYNC_STATE_FILE):
        with open(SYNC_STATE_FILE, 'r') as f:
            return json.load(f)
    return {'synced_files': [], 'last_sync': None}

def save_sync_state(state):
    os.makedirs('data', exist_ok=True)
    with open(SYNC_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def sync_new_posts():
    state = load_sync_state()
    synced = set(state['synced_files'])
    
    # 找出所有原创帖子
    all_posts = glob.glob('content/short-posts/*.md')
    new_posts = [p for p in all_posts if p not in synced]
    
    if not new_posts:
        print(json.dumps({'message': '没有新内容需要同步', 'new_count': 0}))
        return
    
    print(f"发现 {len(new_posts)} 个新帖子，开始同步...")
    
    # 合并新帖子内容
    combined_content = f"# 新增内容 ({datetime.now().strftime('%Y-%m-%d')})\n\n"
    for filepath in new_posts:
        with open(filepath, 'r', encoding='utf-8') as f:
            combined_content += f"---\n## {os.path.basename(filepath)}\n\n{f.read()}\n\n"
    
    # 保存临时文件
    temp_file = '/tmp/new-posts-sync.md'
    with open(temp_file, 'w', encoding='utf-8') as f:
        f.write(combined_content)
    
    # 上传到 NotebookLM
    try:
        result = subprocess.run(
            ['notebooklm', 'source', 'add', temp_file, '--notebook', NOTEBOOK_ID],
            capture_output=True, text=True, timeout=60
        )
        
        if result.returncode == 0:
            # 更新同步状态
            state['synced_files'] = list(synced | set(new_posts))
            state['last_sync'] = datetime.now().isoformat()
            save_sync_state(state)
            
            print(json.dumps({
                'success': True,
                'synced_count': len(new_posts),
                'files': new_posts
            }, ensure_ascii=False))
        else:
            print(json.dumps({
                'success': False,
                'error': result.stderr
            }))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))

if __name__ == '__main__':
    sync_new_posts()
