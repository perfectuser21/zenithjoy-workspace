#!/usr/bin/env python3
"""批量生成 35 张 Deep Post 配图"""

import subprocess
import time
import os
import glob
import shutil
from pathlib import Path

# 读取文案
with open('/tmp/deep-posts-batch-35.txt', 'r') as f:
    content = f.read()

# 解析出每篇 Deep Post
posts = []
lines = content.split('\n')
current_post = None

for line in lines:
    if line.startswith('Deep Post '):
        if current_post:
            posts.append(current_post)
        # 提取标题
        title = line.split(': ', 1)[1] if ': ' in line else line
        current_post = {'title': title, 'content': ''}
    elif current_post and line.strip():
        current_post['content'] += line + ' '

if current_post:
    posts.append(current_post)

print(f"找到 {len(posts)} 篇 Deep Post")

# 创建输出目录
output_dir = Path('output/deep-post-cards')
output_dir.mkdir(parents=True, exist_ok=True)

# 批量生成全部 35 张（从第 4 张开始）
for i, post in enumerate(posts[3:], 4):
    print(f"\n{'='*60}")
    print(f"[{i}/{len(posts)}] {post['title']}")
    print(f"{'='*60}")

    # 构建 prompt
    content_short = post['content'][:200].strip()
    prompt = f"""Create a 9:16 social media image:
- Dark gradient background
- Gold/orange title text
- Off-white body text

Title: {post['title']}
Content: {content_short}

Style: Minimalist, modern magazine, 2-3 abstract icons"""

    # 发送到 ChatGPT
    print("发送 prompt...")
    result = subprocess.run([
        'python3',
        'skills/image-gen-workflow/scripts/send-to-chatgpt.py',
        prompt,
        '-r', 'assets/cards/reference-match-v6.png'
    ], capture_output=True, text=True)

    # 等待生成
    print("等待生成 (60秒)...")
    time.sleep(60)

    # 提取图片
    print("提取图片...")
    result = subprocess.run([
        'python3',
        'skills/image-gen-workflow/scripts/extract-image.py'
    ], capture_output=True, text=True)

    # 查找生成的图片
    generated_images = sorted(glob.glob('/tmp/generated-*.png'), key=os.path.getmtime, reverse=True)

    if generated_images:
        latest_img = generated_images[0]
        # 保存到输出目录
        safe_title = post['title'][:30].replace('/', '-').replace('"', '')
        output_file = output_dir / f"{i:02d}_{safe_title}.png"
        shutil.move(latest_img, output_file)
        print(f"✓ 已保存: {output_file}")
    else:
        print("✗ 提取失败")

print(f"\n{'='*60}")
print("完成！")
print(f"{'='*60}")
print(f"\n生成的图片:")
for img in sorted(output_dir.glob('*.png')):
    size = img.stat().st_size / 1024
    print(f"  {img.name} ({size:.1f} KB)")
