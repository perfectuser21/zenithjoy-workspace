#!/usr/bin/env python3
"""继续批量生成 Deep Post 配图（从第 5 张开始）"""

import subprocess
import time
import glob
import shutil
import sys
from pathlib import Path

# 强制unbuffered输出
sys.stdout = open(sys.stdout.fileno(), mode='w', buffering=1)
sys.stderr = open(sys.stderr.fileno(), mode='w', buffering=1)

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
        title = line.split(': ', 1)[1] if ': ' in line else line
        current_post = {'title': title, 'content': ''}
    elif current_post and line.strip():
        current_post['content'] += line + ' '

if current_post:
    posts.append(current_post)

print(f"找到 {len(posts)} 篇 Deep Post", flush=True)

# 创建输出目录
output_dir = Path('output/deep-post-cards')
output_dir.mkdir(parents=True, exist_ok=True)

# 从第 5 张开始生成
START_INDEX = 5
for i, post in enumerate(posts[START_INDEX-1:], START_INDEX):
    print(f"\n{'='*60}", flush=True)
    print(f"[{i}/{len(posts)}] {post['title']}", flush=True)
    print(f"{'='*60}", flush=True)

    # 构建 prompt
    content_short = post['content'][:200].strip()
    prompt = f"""Create a 9:16 social media image:
- Dark gradient background
- Gold/orange title text
- Off-white body text

Title: {post['title']}
Content: {content_short}

Style: Minimalist, modern magazine, 2-3 abstract icons"""

    # 发送到 ChatGPT (忽略返回码，因为检测不准)
    print("发送 prompt...", flush=True)
    subprocess.run([
        'python3',
        'skills/image-gen-workflow/scripts/send-to-chatgpt.py',
        prompt,
        '-r', 'assets/cards/reference-match-v6.png'
    ], check=False)  # 不检查返回码

    # 等待生成
    print("等待生成 (60秒)...", flush=True)
    time.sleep(60)

    # 提取图片
    print("提取图片...", flush=True)
    result = subprocess.run([
        'python3',
        'skills/image-gen-workflow/scripts/extract-image.py'
    ], capture_output=True, text=True, check=False)

    print(result.stdout, flush=True)
    if result.stderr:
        print(result.stderr, flush=True)

    # 查找生成的图片
    generated_images = sorted(glob.glob('/tmp/generated-*.png'), key=lambda x: Path(x).stat().st_mtime, reverse=True)

    if generated_images:
        latest_img = generated_images[0]
        # 保存到输出目录
        safe_title = post['title'][:30].replace('/', '-').replace('"', '')
        output_file = output_dir / f"{i:02d}_{safe_title}.png"
        shutil.move(latest_img, output_file)
        print(f"✓ 已保存: {output_file}", flush=True)
    else:
        print(f"✗ 提取失败：未找到图片", flush=True)

print(f"\n{'='*60}", flush=True)
print("完成！", flush=True)
print(f"{'='*60}", flush=True)
print(f"\n生成的图片:", flush=True)
for img in sorted(output_dir.glob('*.png')):
    size = img.stat().st_size / 1024
    print(f"  {img.name} ({size:.1f} KB)", flush=True)
