#!/usr/bin/env python3
"""
保存 AI 生成的金句到作品库
用法: python3 save-ai-quote.py "金句内容" [source] [card_image_path]
"""
import os
import sys
import json
from datetime import datetime

def save_quote(quote, source='ai-notebooklm', card_image=None):
    timestamp = datetime.now()
    date_str = timestamp.strftime('%Y-%m-%d')
    time_str = timestamp.strftime('%H%M%S')
    
    # 生成文件名
    safe_title = quote[:20].replace(' ', '-').replace('/', '-')
    filename = f"{date_str}-{time_str}-{safe_title}.md"
    filepath = f"content/ai-generated/{filename}"
    
    # 生成 frontmatter
    content = f"""---
title: "{quote}"
date: {date_str}
source: {source}
type: AI金句
created_at: {timestamp.isoformat()}
card_image: {card_image or 'null'}
---

{quote}
"""
    
    # 保存文件
    os.makedirs('content/ai-generated', exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    result = {
        'success': True,
        'file': filepath,
        'quote': quote,
        'source': source,
        'date': date_str
    }
    
    print(json.dumps(result, ensure_ascii=False))
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: save-ai-quote.py "quote" [source] [card_image]'}))
        sys.exit(1)
    
    quote = sys.argv[1]
    source = sys.argv[2] if len(sys.argv) > 2 else 'ai-notebooklm'
    card_image = sys.argv[3] if len(sys.argv) > 3 else None
    
    save_quote(quote, source, card_image)
